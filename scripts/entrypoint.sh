#!/bin/sh#!/bin/sh



# AIOgames Production Entrypoint Script# AIOgame# Create log# Create log filesecho "🔧 Setting permissions..."



set -e# Set proper permissions (running as root, no ownership changes needed)

chmod 755 /app/logs /app/data /app/config /app/downloads

echo "🚀 Starting AIOgames in production mode..."chmod 755 /app/downloads/temp /app/downloads/completed /app/downloads/incomplete

chmod 644 /app/logs/*.log

echo "📁 Creating directory structure..."

echo "✅ Directory setup completed"/logs/supervisord.log

# Create all required directoriestouch /app/logs/aria2.log

mkdir -p /app/logs touch /app/logs/qbittorrent.log

mkdir -p /app/data touch /app/logs/jdownloader.log

mkdir -p /app/configtouch /app/logs/backend.log

mkdir -p /app/downloads/temp

mkdir -p /app/downloads/completed  echo "🔧 Setting permissions..."

mkdir -p /app/downloads/incomplete

# Set proper permissions (running as root, no ownership changes needed)

# Create log fileschmod 755 /app/logs /app/data /app/config /app/downloads

touch /app/logs/supervisord.logchmod 755 /app/downloads/temp /app/downloads/completed /app/downloads/incomplete

touch /app/logs/aria2.logchmod 644 /app/logs/*.logp/logs/supervisord.log

touch /app/logs/qbittorrent.logtouch /app/logs/aria2.log

touch /app/logs/jdownloader.logtouch /app/logs/qbittorrent.log

touch /app/logs/backend.logtouch /app/logs/jdownloader.log

touch /app/logs/backend.log

echo "🔧 Setting permissions..."

echo "🔧 Setting permissions..."

# Set proper permissions (running as root)

chmod 755 /app/logs /app/data /app/config /app/downloads# Set proper permissions (running as root, so no ownership changes needed)

chmod 755 /app/downloads/temp /app/downloads/completed /app/downloads/incompletechmod 755 /app/logs /app/data /app/config /app/downloads

chmod 644 /app/logs/*.logchmod 755 /app/downloads/temp /app/downloads/completed /app/downloads/incomplete  

chmod 644 /app/logs/*.logrypoint Script

echo "✅ Directory setup completed"

set -e

# Initialize services configuration

echo "🔧 Initializing service configurations..."echo "🚀 Starting AIOgames in production mode..."



# Copy Aria2 config if not exists# Ensure we're running as root for initial setup

if [ ! -f "/config/aria2/aria2.conf" ]; thenif [ "$(id -u)" != "0" ]; then

    mkdir -p /config/aria2    echo "❌ This script must run as root for initial setup"

    cp /config/aria2/aria2.conf /config/aria2/aria2.conf 2>/dev/null || echo "Aria2 config already exists"    exit 1

fifi



# Wait for MongoDB if using local instanceecho "📁 Creating directory structure..."

if [ "${MONGODB_URI}" = "mongodb://mongodb:27017/aiogames" ]; then

    echo "⏳ Waiting for MongoDB..."# Create all required directories first

    while ! nc -z mongodb 27017; domkdir -p /app/logs /app/data /app/config

        sleep 1mkdir -p /app/downloads/{temp,completed,incomplete}

    done

    echo "✅ MongoDB is ready"# Create log files as root

fitouch /app/logs/supervisord.log

touch /app/logs/aria2.log

# Wait a moment for all services to be readytouch /app/logs/qbittorrent.log

sleep 5touch /app/logs/jdownloader.log

touch /app/logs/backend.log

# Test connections

echo "🔍 Testing service connections..."echo "� Setting ownership and permissions..."



# Test Aria2# Set ownership recursively for all app directories

if aria2c --version > /dev/null 2>&1; thenchown -R aiogames:aiogames /app/logs /app/data /app/config /app/downloads

    echo "✅ Aria2 is ready"

else# Set proper permissions

    echo "⚠️  Aria2 test failed"chmod 755 /app/logs /app/data /app/config /app/downloads

fichmod 755 /app/downloads/temp /app/downloads/completed /app/downloads/incomplete

chmod 644 /app/logs/*.log

# Test qBittorrent

if qbittorrent-nox --version > /dev/null 2>&1; thenecho "✅ Directory setup completed"

    echo "✅ qBittorrent is ready"

else# Initialize services configuration

    echo "⚠️  qBittorrent test failed"echo "🔧 Initializing service configurations..."

fi

# Copy Aria2 config if not exists

# Test Java for JDownloaderif [ ! -f "/config/aria2/aria2.conf" ]; then

if java -version > /dev/null 2>&1; then    cp /config/aria2/aria2.conf.default /config/aria2/aria2.conf

    echo "✅ Java is ready for JDownloader"fi

else

    echo "⚠️  Java test failed"# Wait for MongoDB if using local instance

fiif [ "${MONGODB_URI}" = "mongodb://mongodb:27017/aiogames" ]; then

    echo "⏳ Waiting for MongoDB..."

echo "🎯 All services initialized, starting supervisor..."    while ! nc -z mongodb 27017; do

        sleep 1

# Start supervisord as root    done

exec /usr/bin/supervisord -c /etc/supervisord.conf    echo "✅ MongoDB is ready"
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