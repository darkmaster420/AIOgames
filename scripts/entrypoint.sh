#!/bin/sh

# AIOgames Production Entrypoint Script

set -e

echo "🚀 Starting AIOgames in production mode..."

# Set ownership if running as root (fallback)
if [ "$(id -u)" = "0" ]; then
    echo "📁 Setting ownership as root..."
    chown -R aiogames:aiogames /app/logs
    chown -R aiogames:aiogames /app/config
    chown -R aiogames:aiogames /app/downloads
    chown -R aiogames:aiogames /app/data
fi

# Create log files with proper ownership
mkdir -p /app/logs
touch /app/logs/supervisord.log || echo "Warning: Could not create supervisord.log"
touch /app/logs/aria2.log || echo "Warning: Could not create aria2.log"
touch /app/logs/qbittorrent.log || echo "Warning: Could not create qbittorrent.log"
touch /app/logs/jdownloader.log || echo "Warning: Could not create jdownloader.log"
touch /app/logs/backend.log || echo "Warning: Could not create backend.log"

# Set proper permissions
chmod 644 /app/logs/*.log 2>/dev/null || true

# Ensure download directories exist
mkdir -p /app/downloads/temp
mkdir -p /app/downloads/completed
mkdir -p /app/downloads/incomplete

# Initialize services configuration
echo "🔧 Initializing service configurations..."

# Copy Aria2 config if not exists
if [ ! -f "/config/aria2/aria2.conf" ]; then
    cp /config/aria2/aria2.conf.default /config/aria2/aria2.conf
fi

# Wait for MongoDB if using local instance
if [ "${MONGODB_URI}" = "mongodb://mongodb:27017/aiogames" ]; then
    echo "⏳ Waiting for MongoDB..."
    while ! nc -z mongodb 27017; do
        sleep 1
    done
    echo "✅ MongoDB is ready"
fi

# Wait a moment for all services to be ready
sleep 5

# Test connections
echo "🔍 Testing service connections..."

# Test Aria2
if aria2c --version > /dev/null 2>&1; then
    echo "✅ Aria2 is ready"
else
    echo "⚠️  Aria2 test failed"
fi

# Test qBittorrent
if qbittorrent-nox --version > /dev/null 2>&1; then
    echo "✅ qBittorrent is ready"
else
    echo "⚠️  qBittorrent test failed"
fi

# Test Java for JDownloader
if java -version > /dev/null 2>&1; then
    echo "✅ Java is ready for JDownloader"
else
    echo "⚠️  Java test failed"
fi

echo "🎯 All services initialized, starting supervisor..."

# Start supervisord
exec /usr/bin/supervisord -c /etc/supervisord.conf