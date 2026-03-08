import numpy as np
import time
import requests

def generer_trafic():
    # Utilise NumPy pour générer 4 nombres aléatoires (Nord, Sud, Est, Ouest)
    # entre 0 et 20 voitures
    trafic = np.random.randint(0, 21, size=4)
    return {
        "Nord": int(trafic[0]),
        "Sud": int(trafic[1]),
        "Est": int(trafic[2]),
        "Ouest": int(trafic[3])
    }

while True:
    etat = generer_trafic()
    print(f"🚗 Trafic détecté : {etat}")

    # Plus tard, on enverra ça au backend ici :
    # requests.post("http://backend:8080/api/traffic/update", json=etat)

    time.sleep(5) # Attend 5 secondes avant la prochaine mesure