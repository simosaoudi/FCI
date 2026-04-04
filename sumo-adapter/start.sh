#!/bin/bash

set -e

echo "🔄 Installing Python dependencies..."
pip3 install --no-cache-dir websockets aiohttp

echo "🚀 Starting SUMO adapter..."
python3 /app/controle_Traci.py