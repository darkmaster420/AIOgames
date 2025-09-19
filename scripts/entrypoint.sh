#!/bin/sh

# AIOgames Production Entrypoint Script

set -e

echo "🚀 Starting AIOgames in production mode..."

# Create directories first (as root if needed)
mkdir -p /app/logs
mkdir -p /app/downloads/temp
mkdir -p /app/downloads/completed
mkdir -p /app/downloads/incomplete
mkdir -p /app/config
mkdir -p /app/data

# Create log files as root first
touch /app/logs/supervisord.log
touch /app/logs/aria2.log
touch /app/logs/qbittorrent.log
touch /app/logs/jdownloader.log
touch /app/logs/backend.log

# Set ownership for all app directories and files
echo "📁 Setting ownership and permissions..."
chown -R aiogames:aiogames /app/logs
chown -R aiogames:aiogames /app/config
chown -R aiogames:aiogames /app/downloads
chown -R aiogames:aiogames /app/data

# Set proper permissions
chmod 644 /app/logs/*.log
chmod 755 /app/logs
chmod 755 /app/downloads
chmod 755 /app/downloads/temp
chmod 755 /app/downloads/completed
chmod 755 /app/downloads/incomplete
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

# Start supervisord as the aiogames user using gosu
exec gosu aiogames /usr/bin/supervisord -c /etc/supervisord.conf