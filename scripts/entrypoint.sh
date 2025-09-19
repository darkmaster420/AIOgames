#!/bin/sh

# AIOgames Production Entrypoint Script

set -e

echo "🚀 Starting AIOgames in production mode..."

echo "📁 Creating directory structure..."

# Create all required directories
mkdir -p /app/logs 
mkdir -p /app/data 
mkdir -p /app/config
mkdir -p /app/downloads/temp
mkdir -p /app/downloads/completed  
mkdir -p /app/downloads/incomplete

# Create log files
touch /app/logs/supervisord.log
touch /app/logs/aria2.log
touch /app/logs/qbittorrent.log
touch /app/logs/jdownloader.log
touch /app/logs/backend.log

echo "🔧 Setting permissions..."

# Set proper permissions (running as root)
chmod 755 /app/logs /app/data /app/config /app/downloads
chmod 755 /app/downloads/temp /app/downloads/completed /app/downloads/incomplete
chmod 644 /app/logs/*.log

echo "✅ Directory setup completed"

# Initialize services configuration
echo "🔧 Initializing service configurations..."

# Copy Aria2 config if not exists
if [ ! -f "/config/aria2/aria2.conf" ]; then
    mkdir -p /config/aria2
    cp /config/aria2/aria2.conf /config/aria2/aria2.conf 2>/dev/null || echo "Aria2 config already exists"
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

# Start supervisord as root
exec /usr/bin/supervisord -c /etc/supervisord.conf
