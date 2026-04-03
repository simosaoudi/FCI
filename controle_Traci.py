import os
import sys
import traci
from traci.exceptions import TraCIException
import asyncio
import json
import websockets
import subprocess
import time
import aiohttp
from aiohttp import web

# Dynamic traffic-light controller (same directory)
try:
    from dynamic_tls import DynamicTLSController
    _DYN_AVAILABLE = True
except ImportError:
    _DYN_AVAILABLE = False
    print("⚠️  dynamic_tls.py introuvable – contrôle adaptatif désactivé")


def _force_cleanup_traci_default():
    # Best-effort cleanup for rare cases where TraCI thinks 'default' is still active
    try:
        import traci.connection as _tc  # type: ignore
        if hasattr(_tc, "_connections") and isinstance(_tc._connections, dict):
            _tc._connections.pop("default", None)
    except Exception:
        pass


# Configuration de l'environnement SUMO
if 'SUMO_HOME' in os.environ:
    sys.path.append(os.path.join(os.environ['SUMO_HOME'], 'tools'))
else:
    sys.exit("Erreur: Déclarez la variable SUMO_HOME")

connected_clients = set()
last_dashboard_payload = None
scenario_queue = asyncio.Queue()
control_queue = asyncio.Queue()

SPRING_SNAPSHOT_URL = 'http://spring-backend:8080/api/traffic/snapshot'


async def _post_snapshot(session: aiohttp.ClientSession, snapshot: dict) -> None:
    """Envoie un snapshot au backend Spring. Utilise une session partagée (non recréée)."""
    try:
        async with session.post(SPRING_SNAPSHOT_URL, json=snapshot) as resp:
            if resp.status not in (200, 202):
                print(f"⚠️ Snapshot HTTP {resp.status} pour TLS {snapshot.get('tlsId')}")
    except aiohttp.ClientConnectorError:
        print(f"⚠️ Backend injoignable ({SPRING_SNAPSHOT_URL})")
    except Exception as e:
        print(f"⚠️ Erreur HTTP snapshot [{snapshot.get('tlsId')}]: {e}")


def start_sumo(scenario):
    """Lance ou relance SUMO avec le bon scénario"""
    try:
        print("🛑 Fermeture de SUMO...")
        try:
            if getattr(traci, "isLoaded", None) and traci.isLoaded():
                traci.close()
            else:
                traci.close()
        except Exception:
            try:
                traci.close()
            except Exception:
                pass
        _force_cleanup_traci_default()
        time.sleep(1)
    except Exception:
        pass

    print(f"🔄 Régénération pour le scénario : {scenario}")
    try:
        subprocess.run([sys.executable, "generer_simulation.py", scenario], check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ Erreur lors de la génération : {e}")
        return []

    is_docker = os.path.exists('/.dockerenv')
    sumo_binary = "sumo" if is_docker else "sumo-gui"

    args = [
        sumo_binary,
        "-c",
        "simulation.sumocfg",
        "--quit-on-end",
        "--ignore-route-errors",
        "--no-step-log",
        "--no-warnings",
    ]
    try:
        _force_cleanup_traci_default()
        traci.start(args)
    except TraCIException as e:
        # Sometimes the previous connection is still active after a failed restart
        print(f"⚠️ TraCI start failed ({e}), retrying after close...")
        try:
            traci.close()
        except Exception:
            pass
        _force_cleanup_traci_default()
        time.sleep(1)
        traci.start(args)
    return traci.trafficlight.getIDList()


async def http_control_loop():
    async def handle_command(request):
        try:
            data = await request.json()
            action = data.get("action")
            if action:
                print(f"📥 HTTP control reçu: {action} payload={data}")
            if data.get("action") == "SET_SCENARIO":
                scenario = data.get("scenario")
                if scenario:
                    await scenario_queue.put(scenario)
                    print(f"📨 SET_SCENARIO mis en file d'attente: {scenario}")
            elif data.get("action") == "START":
                scenario = data.get("scenario") or "normal"
                await scenario_queue.put(scenario)
                await control_queue.put(data)
                print(f"📨 START mis en file d'attente: {scenario}")
            else:
                # forward other controls to simulation loop
                await control_queue.put(data)
                print(f"📨 Contrôle mis en file d'attente: {data}")
            return web.Response(text="OK")
        except Exception as e:
            print(f"⚠️ Erreur control HTTP : {e}")
            return web.Response(text="ERROR", status=400)

    app = web.Application()
    app.router.add_post('/command', handle_command)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8766)  # Different port for HTTP
    await site.start()
    print("🌐 Serveur HTTP pour commandes démarré sur port 8766")

    # Keep running
    while True:
        await asyncio.sleep(1)


async def simulation_loop():

    global last_dashboard_payload

    current_scenario = "normal"
    restart_needed = True
    regen_env = {}
    traffic_lights = []
    step = 0

    speed_factor = 1.0

    accident_tls_id = None
    accident_lanes = []
    accident_prev_speed = {}
    accident_prev_allowed = {}
    speed_apply_counter = 0
    running = False

    # Multi-incidents state (per lane)
    active_incident_by_lane = {}
    incident_prev_speed = {}
    incident_prev_allowed = {}

    # Dynamic traffic-light controller (reinitialised on each start_sumo)
    dyn_ctrl = None

    # Persistent HTTP session — shared across all steps to avoid per-request socket overhead
    http_session: aiohttp.ClientSession = aiohttp.ClientSession()

    def apply_incident_lane(lane_id, inc_type):
        try:
            l = str(lane_id)
            t = str(inc_type or "ACCIDENT").upper()
            if l not in incident_prev_speed:
                try:
                    incident_prev_speed[l] = traci.lane.getMaxSpeed(l)
                except Exception:
                    incident_prev_speed[l] = None
            if t == "TRAVAUX":
                if l not in incident_prev_allowed:
                    try:
                        incident_prev_allowed[l] = traci.lane.getAllowed(l)
                    except Exception:
                        incident_prev_allowed[l] = None
                try:
                    traci.lane.setAllowed(l, [])
                except Exception:
                    pass
                try:
                    traci.lane.setMaxSpeed(l, 0.01)
                except Exception:
                    pass
            elif t == "BREAKDOWN":
                try:
                    prev = incident_prev_speed.get(l)
                    prev = float(prev) if prev is not None else traci.lane.getMaxSpeed(l)
                    traci.lane.setMaxSpeed(l, max(0.1, prev * 0.10))
                except Exception:
                    pass
            else:
                # ACCIDENT or others: strong slowdown
                try:
                    prev = incident_prev_speed.get(l)
                    prev = float(prev) if prev is not None else traci.lane.getMaxSpeed(l)
                    traci.lane.setMaxSpeed(l, max(0.1, prev * 0.05))
                except Exception:
                    pass
            active_incident_by_lane[l] = t
        except Exception:
            pass

    def restore_incident_lane(lane_id):
        l = str(lane_id)
        try:
            if l in incident_prev_speed and incident_prev_speed[l] is not None:
                traci.lane.setMaxSpeed(l, incident_prev_speed[l])
        except Exception:
            pass
        try:
            if l in incident_prev_allowed and incident_prev_allowed[l] is not None:
                traci.lane.setAllowed(l, incident_prev_allowed[l])
        except Exception:
            pass
        incident_prev_speed.pop(l, None)
        incident_prev_allowed.pop(l, None)
        active_incident_by_lane.pop(l, None)

    try:
        while True:
            if restart_needed:
                traffic_lights = start_sumo(current_scenario)
                step = 0
                running = False
                restart_needed = False

                # Recycle HTTP session to avoid stale connections after restart
                if not http_session.closed:
                    await http_session.close()
                http_session = aiohttp.ClientSession()

                # (Re)initialise the dynamic controller for the new network state
                if _DYN_AVAILABLE:
                    dyn_ctrl = DynamicTLSController(
                        tls_ids=list(traffic_lights),
                        active_incidents=active_incident_by_lane,
                    )
                    print("✅ DynamicTLSController initialisé")
                else:
                    dyn_ctrl = None

            if not scenario_queue.empty():

                latest_scenario = await scenario_queue.get()
                while not scenario_queue.empty():
                    latest_scenario = await scenario_queue.get()

                if latest_scenario and latest_scenario != current_scenario:
                    current_scenario = latest_scenario
                    print(f"📡 Changement vers : {current_scenario}")
                    restart_needed = True
                    continue

            # Apply pending controls (speed / accident)
            if not control_queue.empty():

                latest = await control_queue.get()
                while not control_queue.empty():
                    latest = await control_queue.get()

                try:
                    action = latest.get("action")
                    if action == "SET_SPEED":

                        sf = latest.get("speedFactor")
                        if sf is not None:
                            speed_factor = float(sf)
                            try:
                                traci.simulation.setScale(speed_factor)
                                print(f"⚙️ SET_SPEED appliqué via simulation.setScale({speed_factor})")
                            except Exception as e:
                                print(f"⚠️ setScale non supporté, fallback vehicle.setSpeedFactor: {e}")
                                try:
                                    for vid in traci.vehicle.getIDList():
                                        traci.vehicle.setSpeedFactor(str(vid), speed_factor)
                                    print(f"⚙️ SET_SPEED appliqué via vehicle.setSpeedFactor({speed_factor})")
                                except Exception as e2:
                                    print(f"⚠️ fallback setSpeedFactor échoué: {e2}")
                    elif action == "SET_TRAFFIC":

                        sc = str(latest.get("scenario") or "normal").lower()
                        period = latest.get("trafficPeriod")
                        fringe = latest.get("trafficFringe")

                        # Update env overrides for generator
                        if period is not None:
                            try:
                                p = float(period)
                                if sc == "pic":
                                    os.environ["TRAFFIC_PIC_PERIOD"] = str(p)
                                elif sc == "incident":
                                    os.environ["TRAFFIC_INCIDENT_PERIOD"] = str(p)
                                else:
                                    os.environ["TRAFFIC_NORMAL_PERIOD"] = str(p)
                            except Exception:
                                pass
                        if fringe is not None:
                            try:
                                f = float(fringe)
                                if sc == "pic":
                                    os.environ["TRAFFIC_PIC_FRINGE"] = str(f)
                                elif sc == "incident":
                                    os.environ["TRAFFIC_INCIDENT_FRINGE"] = str(f)
                                else:
                                    os.environ["TRAFFIC_NORMAL_FRINGE"] = str(f)
                            except Exception:
                                pass

                        # Regenerate traffic for current scenario (keep scenario unchanged unless provided)
                        if sc and sc != current_scenario:
                            current_scenario = sc
                        print(f"🚦 SET_TRAFFIC: scenario={current_scenario} period={period} fringe={fringe} -> restart")
                        restart_needed = True
                        continue
                    elif action == "SET_ACCIDENT":

                        tls_id = latest.get("accidentJunctionId") or latest.get("junctionId")
                        lane_id = latest.get("laneId")
                        incident_type = str(latest.get("incidentType") or "ACCIDENT").upper()
                        accident_tls_id = str(tls_id) if tls_id else None
                        accident_lane_id = str(lane_id) if lane_id else None

                        # Backward compat: SET_ACCIDENT replaces all incidents
                        for l in list(active_incident_by_lane.keys()):
                            restore_incident_lane(l)

                        # restore previous accident lane state (speed + allowed)
                        for l, prev in list(accident_prev_speed.items()):
                            try:
                                traci.lane.setMaxSpeed(l, prev)
                            except Exception:
                                pass
                        for l, prev in list(accident_prev_allowed.items()):
                            try:
                                traci.lane.setAllowed(l, prev)
                            except Exception:
                                pass
                        accident_prev_speed = {}
                        accident_prev_allowed = {}

                        target_lanes = []
                        if accident_lane_id:
                            target_lanes = [accident_lane_id]
                            print(f"🚧 SET_ACCIDENT sur voie {accident_lane_id}")
                        elif accident_tls_id:
                            print(f"🚧 SET_ACCIDENT sur carrefour {accident_tls_id}")
                            try:
                                controlled = traci.trafficlight.getControlledLanes(accident_tls_id)
                                target_lanes = list(set([str(x) for x in controlled]))
                            except Exception as e:
                                print(f"⚠️ Erreur accident TLS {accident_tls_id}: {e}")
                                target_lanes = []
                        else:
                            # empty payload => clear
                            target_lanes = []

                        if target_lanes:
                            accident_lanes = target_lanes
                            for l in accident_lanes:

                                try:
                                    prev = traci.lane.getMaxSpeed(l)
                                    accident_prev_speed[l] = prev
                                    if incident_type == "TRAVAUX":
                                        try:
                                            prev_allowed = traci.lane.getAllowed(l)
                                            accident_prev_allowed[l] = prev_allowed
                                            traci.lane.setAllowed(l, [])
                                        except Exception:
                                            pass
                                        traci.lane.setMaxSpeed(l, 0.01)
                                    elif incident_type == "BREAKDOWN":
                                        traci.lane.setMaxSpeed(l, max(0.1, prev * 0.10))
                                    else:
                                        traci.lane.setMaxSpeed(l, max(0.1, prev * 0.05))
                                except Exception:
                                    pass
                            if incident_type == "TRAVAUX":
                                print(f"🚧 TRAVAUX appliqué: {len(accident_lanes)} lanes bloquées")
                            else:
                                print(f"🚧 Incident appliqué: {len(accident_lanes)} lanes ralenties")

                            # Also register in multi-incidents map
                            for l in accident_lanes:
                                apply_incident_lane(l, incident_type)

                    elif action == "ADD_INCIDENT":
                        tls_id = latest.get("accidentJunctionId") or latest.get("junctionId")
                        lane_id = latest.get("laneId")
                        incident_type = str(latest.get("incidentType") or "ACCIDENT").upper()

                        target_lanes = []
                        if lane_id:
                            target_lanes = [str(lane_id)]
                        elif tls_id:
                            try:
                                controlled = traci.trafficlight.getControlledLanes(str(tls_id))
                                target_lanes = list(set([str(x) for x in controlled]))
                            except Exception:
                                target_lanes = []

                        for l in target_lanes:
                            apply_incident_lane(l, incident_type)
                        if incident_type == "TRAVAUX":
                            print(f"🚧 ADD_INCIDENT TRAVAUX: {len(target_lanes)} lanes bloquées")
                        else:
                            print(f"🚧 ADD_INCIDENT {incident_type}: {len(target_lanes)} lanes")

                    elif action == "REMOVE_INCIDENT":
                        lane_id = latest.get("laneId")
                        if lane_id:
                            restore_incident_lane(str(lane_id))
                            print(f"🧹 REMOVE_INCIDENT: {lane_id}")

                    elif action == "CLEAR_INCIDENTS":
                        for l in list(active_incident_by_lane.keys()):
                            restore_incident_lane(l)
                        print("🧹 CLEAR_INCIDENTS")

                    elif action == "STOP":
                        running = False
                        print("⏸️ STOP reçu: simulation en pause")
                    elif action == "START":
                        running = True
                        # START may optionally contain scenario
                        sc = latest.get("scenario")
                        if sc and sc != current_scenario:
                            await scenario_queue.put(sc)
                        print("▶️ START reçu: simulation reprise")

                except Exception as e:
                    print(f"⚠️ Erreur application control: {e}")

            try:
                if not running:
                    await asyncio.sleep(0.1)
                    continue

                traci.simulationStep()

                # Ensure speed factor is applied even if setScale is unsupported (light periodic apply)
                speed_apply_counter += 1
                if speed_apply_counter % 20 == 0:
                    try:
                        for vid in traci.vehicle.getIDList():
                            traci.vehicle.setSpeedFactor(str(vid), speed_factor)
                    except Exception:
                        pass

                stats = {}
                for tls_id in traffic_lights:

                    controlled_lanes = traci.trafficlight.getControlledLanes(str(tls_id))
                    lanes = list(set(controlled_lanes))

                    current_phase = traci.trafficlight.getPhase(str(tls_id))
                    phase_value = int(current_phase) if not isinstance(current_phase, tuple) else int(current_phase[0])

                    carrefour_data = {
                        "total_attente": 0,
                        "bras": {},
                        "phase": phase_value
                    }

                    for l in lanes:
                        nb_stop = traci.lane.getLastStepHaltingNumber(str(l))

                        if isinstance(nb_stop, tuple):
                            count = int(nb_stop[0])
                        else:
                            count = int(nb_stop)

                        carrefour_data["bras"][str(l)] = count
                        carrefour_data["total_attente"] += count

                    stats[str(tls_id)] = carrefour_data

                # ── Dynamic TLS control (runs once per CTRL_INTERVAL steps) ──────────
                dyn_decisions: dict = {}
                if dyn_ctrl is not None:
                    try:
                        dyn_decisions = dyn_ctrl.step(step)
                    except Exception as _e:
                        print(f"⚠️ DynamicTLSController.step error: {_e}")

                dashboard_payload = {
                    "step": step,
                    "data": stats,
                    "scenario": current_scenario
                }
                last_dashboard_payload = json.dumps(dashboard_payload)

                if connected_clients and last_dashboard_payload:
                    to_remove = []
                    for ws in list(connected_clients):
                        try:
                            await ws.send(last_dashboard_payload)
                        except Exception:
                            to_remove.append(ws)
                    for ws in to_remove:
                        connected_clients.discard(ws)

                ts = int(time.time() * 1000)

                # Real vehicles positions (global list)
                vehicles = []
                try:
                    for vid in traci.vehicle.getIDList():
                        x, y = traci.vehicle.getPosition(vid)
                        sp = traci.vehicle.getSpeed(vid)
                        ang = traci.vehicle.getAngle(vid)
                        vehicles.append({
                            "id": str(vid),
                            "x": float(x),
                            "y": float(y),
                            "speed": float(sp),
                            "angle": float(ang),
                        })
                except Exception:
                    vehicles = []

                # ── Build all snapshots (TraCI reads) then send in parallel ──────────
                snapshots_to_send = []
                for tls_id, carrefour_data in stats.items():
                    tl_state = None
                    controlled_lanes = []
                    lane_signal_states = {}
                    try:
                        tl_state = traci.trafficlight.getRedYellowGreenState(str(tls_id))
                    except Exception:
                        tl_state = None
                    try:
                        controlled_lanes = list(traci.trafficlight.getControlledLanes(str(tls_id)))
                    except Exception:
                        controlled_lanes = []

                    # Build a per-incoming-lane signal state mapping using controlledLinks
                    try:
                        if tl_state is not None:
                            links = traci.trafficlight.getControlledLinks(str(tls_id))
                            for i, link_group in enumerate(links):
                                if i >= len(tl_state):
                                    break
                                ch = str(tl_state[i])
                                for link in link_group:
                                    try:
                                        from_lane = str(link[0])
                                    except Exception:
                                        continue
                                    prev = lane_signal_states.get(from_lane)
                                    if prev in ("G", "g"):
                                        continue
                                    if ch in ("G", "g"):
                                        lane_signal_states[from_lane] = "G"
                                    elif ch in ("y", "Y"):
                                        if prev not in ("G", "g"):
                                            lane_signal_states[from_lane] = "y"
                                    else:
                                        lane_signal_states.setdefault(from_lane, "r")
                    except Exception:
                        lane_signal_states = {}

                    # Per-TLS algorithm state
                    alg_state: dict = {}
                    if dyn_ctrl is not None:
                        try:
                            alg_state = dyn_ctrl.get_tls_algorithm_state(str(tls_id))
                        except Exception:
                            alg_state = {}
                    if str(tls_id) in dyn_decisions:
                        d = dyn_decisions[str(tls_id)]
                        alg_state["greenDurations"] = {str(k): round(v, 1) for k, v in d.green_durations.items()}
                        alg_state["demandScores"] = {str(k): round(v, 2) for k, v in d.demand_scores.items()}
                        alg_state["strategy"] = d.strategy
                        alg_state["cycleLength"] = round(d.cycle_length, 1)

                    snapshots_to_send.append({
                        "ts": ts,
                        "step": step,
                        "scenario": current_scenario,
                        "tlsId": str(tls_id),
                        "phase": int(carrefour_data.get("phase", 0)),
                        "tlState": str(tl_state) if tl_state is not None else None,
                        "controlledLanes": [str(x) for x in controlled_lanes],
                        "laneSignalStates": lane_signal_states,
                        "lanes": carrefour_data.get("bras", {}),
                        "totalHalted": int(carrefour_data.get("total_attente", 0)),
                        "vehicles": vehicles,
                        "algorithmState": alg_state,
                    })

                # ── Send all snapshots in PARALLEL — single shared session ─────────
                if snapshots_to_send and not http_session.closed:
                    await asyncio.gather(
                        *[_post_snapshot(http_session, snap) for snap in snapshots_to_send],
                        return_exceptions=True,
                    )

                step += 1
                base_sleep = 0.05
                sf = speed_factor if speed_factor and speed_factor > 0 else 1.0
                await asyncio.sleep(max(0.005, base_sleep / sf))

            except Exception as e:
                if "FatalTraCIError" in str(e) or "connection closed" in str(e).lower():
                    print("🏁 Fin de simulation ou SUMO fermé.")
                    await asyncio.sleep(1)
                    restart_needed = True
                else:
                    print(f"⚠️ Erreur simulation : {e}")
                    await asyncio.sleep(1)

    finally:
        try:
            traci.close()
        except Exception:
            pass
        if not http_session.closed:
            await http_session.close()

async def run_sumo_logic(websocket):
    print("🌐 Dashboard connecté")
    try:
        connected_clients.add(websocket)
        while True:
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=0.05)
                data = json.loads(message)

                if data.get("action") == "trigger_scenario":
                    scenario = data.get("value") or data.get("scenario")
                    if scenario:
                        await scenario_queue.put(scenario)
            except asyncio.TimeoutError:
                pass
            except websockets.exceptions.ConnectionClosed:
                break

            if last_dashboard_payload:
                try:
                    await websocket.send(last_dashboard_payload)
                except websockets.exceptions.ConnectionClosed:
                    break

    finally:
        connected_clients.discard(websocket)

async def main():
    # Écoute sur 0.0.0.0 pour Docker, localhost pour Windows
    host = "0.0.0.0" if os.path.exists('/.dockerenv') else "localhost"
    print(f"🚀 Serveur prêt sur ws://{host}:8765 et http://{host}:8766")

    try:
        http_task = asyncio.create_task(http_control_loop())
        sim_task = asyncio.create_task(simulation_loop())
        async with websockets.serve(run_sumo_logic, host, 8765, ping_interval=None):
            await asyncio.gather(http_task, sim_task)

    finally:
        pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("🛑 Serveur arrêté.")