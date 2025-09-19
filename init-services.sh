#!/bin/bash
set -e

# Initialize aria2
echo "Initializing aria2..."
if [ ! -f /config/aria2/aria2.conf ]; then
    cat > /config/aria2/aria2.conf << EOL
dir=/downloads
enable-rpc=true
rpc-listen-all=true
rpc-allow-origin-all=true
rpc-secret=aiogames123
continue=true
max-concurrent-downloads=5
max-connection-per-server=5
min-split-size=10M
split=10
daemon=false
log=/app/logs/aria2.log
log-level=info
EOL
fi

# Initialize qBittorrent
echo "Initializing qBittorrent..."
if [ ! -f /config/qbittorrent/qBittorrent.conf ]; then
    mkdir -p /config/qbittorrent/config
    cat > /config/qbittorrent/config/qBittorrent.conf << EOL
[Preferences]
WebUI\Username=admin
WebUI\Password=adminadmin
WebUI\Port=8080
WebUI\Address=*
WebUI\CSRFProtection=false
WebUI\ClickjackingProtection=false
WebUI\LocalHostAuth=false
Downloads\SavePath=/downloads
Downloads\TempPath=/downloads/temp
EOL
    chown -R appuser:appgroup /config/qbittorrent
fi

# Initialize JDownloader
echo "Initializing JDownloader..."
if [ ! -d /config/jd2/cfg ]; then
    mkdir -p /config/jd2/cfg
    cat > /config/jd2/cfg/org.jdownloader.api.myjdownloader.MyJDownloaderSettings.json << EOL
{
    "email": "chinesehacker101@gmail.com",
    "password": "5rM6*EQwNUxm5_C",
    "devicename": "aiogames",
    "autoconnectenabledv2": true
}
EOL
    chown -R appuser:appgroup /config/jd2
fi

# Wait for services to start and test connections
echo "Testing service connections..."

# Wait for qBittorrent to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:8080/api/v2/app/version >/dev/null; then
    echo "qBittorrent is ready"
    break
  fi
  echo "Waiting for qBittorrent... (attempt $i/30)"
  sleep 2
done

# Test qBittorrent login
COOKIE=$(curl -i -s -c - -d "username=admin&password=adminadmin" http://localhost:8080/api/v2/auth/login | grep SID | awk '{print $7}')
if [ -n "$COOKIE" ]; then
  echo "Successfully logged in to qBittorrent"
else
  echo "Failed to log in to qBittorrent"
fi

# Wait for Aria2 to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:6800/jsonrpc -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"aria2.getVersion","id":"aiogames","params":["token:aiogames123"]}' >/dev/null; then
    echo "Aria2 is ready"
    break
  fi
  echo "Waiting for Aria2... (attempt $i/30)"
  sleep 2
done

# Test Aria2 connection
ARIA2_VERSION=$(curl -s http://localhost:6800/jsonrpc -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"aria2.getVersion","id":"aiogames","params":["token:aiogames123"]}' | jq -r '.result.version')
if [ -n "$ARIA2_VERSION" ]; then
  echo "Successfully connected to Aria2 version $ARIA2_VERSION"
else
  echo "Failed to connect to Aria2"
fi

# Wait for JDownloader to start
for i in $(seq 1 60); do
  if [ -f "/config/jd2/cfg/org.jdownloader.api.myjdownloader.MyJDownloaderSettings.json" ]; then
    echo "JDownloader configuration is ready"
    break
  fi
  echo "Waiting for JDownloader configuration... (attempt $i/60)"
  sleep 2
done

echo "All services initialized successfully at $(date)"