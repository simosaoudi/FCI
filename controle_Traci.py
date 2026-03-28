import os
import sys
import traci
import asyncio
import json
import websockets
import subprocess
import time
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

# Configuration de l'environnement SUMO
if 'SUMO_HOME' in os.environ:
    sys.path.append(os.path.join(os.environ['SUMO_HOME'], 'tools'))
else:
    sys.exit("Erreur: Déclarez la variable SUMO_HOME")

connected_clients = set()
last_dashboard_payload = None
scenario_queue = asyncio.Queue()
control_queue = asyncio.Queue()


def start_sumo(scenario):
    """Lance ou relance SUMO avec le bon scénario"""
    try:
        print("🛑 Fermeture de SUMO...")
        traci.close()
        import time
        time.sleep(1)
    except:
        pass

    print(f"🔄 Régénération pour le scénario : {scenario}")
    try:
        subprocess.run([sys.executable, "generer_simulation.py", scenario], check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ Erreur lors de la génération : {e}")
        return []

    is_docker = os.path.exists('/.dockerenv')
    sumo_binary = "sumo" if is_docker else "sumo-gui"
    traci.start([sumo_binary, "-c", "simulation.sumocfg", "--start", "--quit-on-end"])
    return traci.trafficlight.getIDList()


async def kafka_control_loop(bootstrap_servers, topic):

    while True:
        consumer = AIOKafkaConsumer(
            topic,
            bootstrap_servers=bootstrap_servers,
            group_id="sumo-adapter",
            auto_offset_reset="latest",
            enable_auto_commit=True,
        )

        try:
            await consumer.start()
            async for msg in consumer:
                try:
                    data = json.loads(msg.value.decode("utf-8"))
                    if data.get("action") == "SET_SCENARIO":
                        scenario = data.get("scenario")
                        if scenario:
                            await scenario_queue.put(scenario)
                    elif data.get("action") == "START":
                        scenario = data.get("scenario") or "normal"
                        await scenario_queue.put(scenario)
                    else:
                        # forward other controls to simulation loop
                        await control_queue.put(data)
                except Exception as e:
                    print(f"⚠️ Erreur control Kafka : {e}")

        except Exception as e:
            print(f"⏳ Kafka control non prêt ({topic}) : {e}")
            await asyncio.sleep(1)
        finally:
            try:
                await consumer.stop()
            except Exception:
                pass


async def simulation_loop(producer, snapshot_topic):

    global last_dashboard_payload

    current_scenario = "normal"
    restart_needed = True
    traffic_lights = []
    step = 0

    speed_factor = 1.0
    accident_tls_id = None
    accident_lanes = []
    accident_prev_speed = {}

    try:
        while True:
            if restart_needed:
                traffic_lights = start_sumo(current_scenario)
                step = 0
                restart_needed = False

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
                            except Exception as e:
                                print(f"⚠️ setScale non supporté: {e}")
                    elif action == "SET_ACCIDENT":
                        tls_id = latest.get("accidentJunctionId") or latest.get("junctionId")
                        accident_tls_id = str(tls_id) if tls_id else None
                        # restore previous accident lane speeds
                        for l, prev in list(accident_prev_speed.items()):
                            try:
                                traci.lane.setMaxSpeed(l, prev)
                            except Exception:
                                pass
                        accident_prev_speed = {}
                        accident_lanes = []

                        if accident_tls_id:
                            try:
                                controlled = traci.trafficlight.getControlledLanes(accident_tls_id)
                                accident_lanes = list(set([str(x) for x in controlled]))
                                for l in accident_lanes:
                                    try:
                                        prev = traci.lane.getMaxSpeed(l)
                                        accident_prev_speed[l] = prev
                                        traci.lane.setMaxSpeed(l, max(0.1, prev * 0.05))
                                    except Exception:
                                        pass
                            except Exception as e:
                                print(f"⚠️ Erreur accident TLS {accident_tls_id}: {e}")
                except Exception as e:
                    print(f"⚠️ Erreur application control: {e}")

            try:
                traci.simulationStep()

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

                    # Adaptive control (simple): adjust current phase duration based on queue
                    try:
                        total_q = int(carrefour_data.get("total_attente", 0))
                        desired = 5 + min(55, int(total_q * 2))
                        traci.trafficlight.setPhaseDuration(str(tls_id), float(desired))
                    except Exception:
                        pass

                    stats[str(tls_id)] = carrefour_data

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

                for tls_id, carrefour_data in stats.items():
                    snapshot = {
                        "ts": ts,
                        "step": step,
                        "scenario": current_scenario,
                        "tlsId": str(tls_id),
                        "phase": int(carrefour_data.get("phase", 0)),
                        "lanes": carrefour_data.get("bras", {}),
                        "totalHalted": int(carrefour_data.get("total_attente", 0)),
                        "vehicles": vehicles,
                    }
                    await producer.send_and_wait(snapshot_topic, json.dumps(snapshot).encode("utf-8"))

                step += 1
                await asyncio.sleep(0.05)

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
        except:
            pass

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
    print(f"🚀 Serveur prêt sur ws://{host}:8765")

    kafka_bootstrap = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
    snapshot_topic = os.getenv("KAFKA_TOPIC_TRAFFIC_SNAPSHOT", "traffic.snapshot")
    control_topic = os.getenv("KAFKA_TOPIC_SIMULATION_CONTROL", "simulation.control")

    producer = AIOKafkaProducer(bootstrap_servers=kafka_bootstrap)
    await producer.start()
    try:
        kafka_task = asyncio.create_task(kafka_control_loop(kafka_bootstrap, control_topic))
        sim_task = asyncio.create_task(simulation_loop(producer, snapshot_topic))
        async with websockets.serve(run_sumo_logic, host, 8765, ping_interval=None):
            await asyncio.gather(kafka_task, sim_task)
    finally:
        await producer.stop()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("🛑 Serveur arrêté.")