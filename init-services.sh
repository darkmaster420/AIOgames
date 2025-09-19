#!/bin/bash
set -e

# Initialize aria2
echo "Initializing aria2..."
if [ ! -f /app/config/aria2.conf ]; then
    cat > /app/config/aria2.conf << EOL
dir=/app/downloads
enable-rpc=true
rpc-listen-all=true
rpc-allow-origin-all=true
rpc-secret=${ARIA2_SECRET:-changeme}
continue=true
max-concurrent-downloads=5
max-connection-per-server=5
min-split-size=10M
split=10
EOL
fi

# Initialize qBittorrent
echo "Initializing qBittorrent..."
if [ ! -f /app/config/qBittorrent/qBittorrent.conf ]; then
    mkdir -p /app/config/qBittorrent
    cat > /app/config/qBittorrent/qBittorrent.conf << EOL
[Preferences]
WebUI\Username=${QB_USERNAME:-admin}
WebUI\Password_PBKDF2="@ByteArray(${QB_PASSWORD:-adminadmin})"
WebUI\Port=8080
WebUI\Address=*
Downloads\SavePath=/app/downloads
EOL
fi

# Initialize JDownloader
echo "Initializing JDownloader..."
if [ ! -f /app/config/jdownloader.json ]; then
    cat > /app/config/jdownloader.json << EOL
{
    "email": "${JD_EMAIL}",
    "password": "${JD_PASSWORD}",
    "deviceName": "AIOGames",
    "downloadPath": "/app/downloads"
}
EOL
fi

echo "All services initialized successfully"