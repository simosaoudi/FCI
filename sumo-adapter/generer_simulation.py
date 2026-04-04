import os
import subprocess
import sys


# Period (seconds between consecutive departures) for each NORMAL traffic level.
# transit_time ≈ 90s on this 4×3 grid with 250m edges.
# concurrent_vehicles ≈ transit_time / period  →  period = 90 / target_count
LEVEL_PERIODS = {
    "N1": "18.0",   # ≈  5 concurrent vehicles
    "N2":  "9.0",   # ≈ 10 concurrent vehicles
    "N3":  "6.0",   # ≈ 15 concurrent vehicles
    "N4":  "4.5",   # ≈ 20 concurrent vehicles
    "N5":  "3.0",   # ≈ 30 concurrent vehicles
    "N6":  "1.8",   # ≈ 50 concurrent vehicles
}

# Presets for PIC / INCIDENT scenarios (env-var overridable)
SCENARIO_PARAMS = {
    "normal":   {"period": os.getenv("TRAFFIC_NORMAL_PERIOD",   "18.0"), "fringe": "1.0"},
    "pic":      {"period": os.getenv("TRAFFIC_PIC_PERIOD",       "0.5"), "fringe": "3.0"},
    "incident": {"period": os.getenv("TRAFFIC_INCIDENT_PERIOD",  "1.5"), "fringe": "2.0"},
}


def generer(scenario="normal", traffic_level=None):
    """
    Generate SUMO network + routes.

    Parameters
    ----------
    scenario      : "normal" | "pic" | "incident"
    traffic_level : "N1"…"N6" — used only for scenario=="normal".
                    For pic/incident the preset period is used regardless.
    """
    if 'SUMO_HOME' not in os.environ:
        sys.exit("Erreur : Déclarez la variable SUMO_HOME")

    net_file = 'reseau_12_carrefours.net.xml'
    cfg_file = 'simulation.sumocfg'

    p = SCENARIO_PARAMS.get(scenario, SCENARIO_PARAMS["normal"])

    # --- Determine period and fringe ---
    if scenario == "normal" and traffic_level and traffic_level.upper() in LEVEL_PERIODS:
        period = LEVEL_PERIODS[traffic_level.upper()]
        fringe = "1.0"   # fixed fringe for predictable concurrent count
        label  = f"NORMAL {traffic_level.upper()} (≈{int(90 / float(period))} véh. concurrents)"
    else:
        period = p["period"]
        fringe = p["fringe"]
        label  = f"{scenario} (period={period}s)"

    print(f"🚧 Génération réseau + trafic : {label}")

    # 1. Generate road network (4×3 grid, 2 lanes per direction)
    subprocess.run([
        'netgenerate',
        '--grid',
        '--grid.x-number=4',
        '--grid.y-number=3',
        '--grid.length=250',
        '--default.lanenumber', '2',
        '--default-junction-type', 'traffic_light',
        '--tls.default-type', 'static',
        '-o', net_file,
    ], check=True)

    # 2. Generate traffic routes with randomTrips.py
    sumo_home = os.environ['SUMO_HOME']
    random_trips = os.path.join(sumo_home, 'tools', 'randomTrips.py')

    subprocess.run([
        sys.executable, random_trips,
        '-n', net_file,
        '-p', period,
        '--fringe-factor', fringe,
        '--validate',
        '--remove-loops',
        '--min-distance', '30',
        '--route-file', 'trafic.rou.xml',
        '--end', '3600',
    ], check=True)

    # 3. Write SUMO configuration file
    with open(cfg_file, "w") as f:
        f.write(f"""<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <input>
        <net-file value="{net_file}"/>
        <route-files value="trafic.rou.xml"/>
    </input>
</configuration>""")


if __name__ == "__main__":
    scenario      = sys.argv[1] if len(sys.argv) > 1 else "normal"
    traffic_level = sys.argv[2] if len(sys.argv) > 2 else None
    generer(scenario, traffic_level=traffic_level)
