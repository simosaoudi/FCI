FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Installation de SUMO et des outils nécessaires
RUN apt-get update && apt-get install -y \
    sumo \
    sumo-tools \
    python3 \
    python3-pip \
    dos2unix \
    && rm -rf /var/lib/apt/lists/*

# CONFIGURATION CRUCIALE POUR L'INGÉNIEUR CLOUD :
# On définit où se trouve SUMO
ENV SUMO_HOME=/usr/share/sumo
# On dit à Python d'aller chercher les modules (traci, sumolib) dans les outils de SUMO
ENV PYTHONPATH=/usr/share/sumo/tools

# Force rebuild - attempt 3
RUN pip3 install --upgrade pip
RUN pip3 install --no-cache-dir websockets aiohttp
RUN python3 -c "import aiohttp; print('aiohttp installed successfully')"

WORKDIR /app
COPY . /app
RUN dos2unix start.sh
RUN chmod +x start.sh

EXPOSE 8765

CMD ["/bin/bash", "start.sh"]