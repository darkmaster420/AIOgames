#!/bin/bash

echo "🚀 Starting AIOgames Update Tracker in Docker..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ .env.local file not found!"
    echo "📝 Please copy .env.production to .env.local and configure your settings:"
    echo "   cp .env.production .env.local"
    echo "   nano .env.local"
    exit 1
fi

echo "🧹 Cleaning up any existing containers..."
docker-compose down

echo "📦 Building fresh Docker image..."
docker-compose build --no-cache

echo "🎯 Starting the application..."
docker-compose up -d

echo "⏳ Waiting for the application to start..."
sleep 10

# Check if the application is healthy
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ Application is running successfully!"
    echo "🌐 Visit: http://localhost:3000"
    echo "📊 Health check: http://localhost:3000/api/health"
    echo ""
    echo "📝 To view logs: docker-compose logs -f"
    echo "🛑 To stop: docker-compose down"
else
    echo "⚠️  Application may still be starting up..."
    echo "📝 Check logs: docker-compose logs -f"
fi

echo ""
echo "🐳 Docker containers:"
docker-compose ps