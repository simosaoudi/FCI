# 1. Utiliser une image Python officielle
FROM python:3.11-slim

# 2. Définir le dossier de travail dans le conteneur
WORKDIR /app

# 3. Copier les dépendances et les installer
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copier tout le reste du code
COPY . .

# 5. Lancer le script
CMD ["python", "simulator.py"]