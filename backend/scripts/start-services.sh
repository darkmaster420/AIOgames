#!/bin/bash

# Stop any running instances
killall -9 aria2c qbittorrent-nox 2>/dev/null || true

# Create directories
sudo mkdir -p /downloads /downloads/temp
sudo chmod 777 /downloads /downloads/temp

# Start aria2c
aria2c --conf-path=/workspaces/AIOgames/backend/config/aria2.conf --daemon

# Start qBittorrent
qbittorrent-nox --webui-port=8080 --profile=/workspaces/AIOgames/backend/config/qBittorrent --daemon

# Wait for services to start
sleep 2

# Check if services are running
ps aux | grep -v grep | grep aria2c
ps aux | grep -v grep | grep qbittorrent-nox

echo "Services started. Check the logs if there are any issues."