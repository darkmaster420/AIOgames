#!/bin/sh

# AIOgames Production Entrypoint Script

set -e

echo "🚀 Starting AIOgames in production mode..."

# Ensure we're running as root for initial setup
if [ "$(id -u)" != "0" ]; then
    echo "❌ This script must run as root for initial setup"
    exit 1
fi

echo "📁 Creating directory structure as root..."

# Handle existing volumes by setting permissions first
if [ -d "/app/logs" ]; then
    chmod 755 /app/logs 2>/dev/null || true
fi
if [ -d "/app/downloads" ]; then  
    chmod 755 /app/downloads 2>/dev/null || true
fi
if [ -d "/app/config" ]; then
    chmod 755 /app/config 2>/dev/null || true  
fi
if [ -d "/app/data" ]; then
    chmod 755 /app/data 2>/dev/null || true
fi

# Force create all directories as root with proper permissions
mkdir -p /app/logs /app/data /app/config
mkdir -p /app/downloads/{temp,completed,incomplete}

# Create log files as root
touch /app/logs/supervisord.log
touch /app/logs/aria2.log
touch /app/logs/qbittorrent.log
touch /app/logs/jdownloader.log
touch /app/logs/backend.log

echo "� Setting ownership and permissions..."

# Set ownership recursively for all app directories
chown -R aiogames:aiogames /app/logs /app/data /app/config /app/downloads

# Set proper permissions
chmod 755 /app/logs /app/data /app/config /app/downloads
chmod 755 /app/downloads/temp /app/downloads/completed /app/downloads/incomplete
chmod 644 /app/logs/*.log

echo "✅ Directory setup completed"
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