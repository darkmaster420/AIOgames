#!/bin/bash

# AIOgames Development Environment Setup
# This script starts MongoDB in Docker and runs the app in development mode

set -e

echo "🚀 Starting AIOgames Development Environment"
echo "============================================"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not running"
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    
    # Update for local development
    sed -i.bak 's|mongodb://mongodb:27017/aiogames|mongodb://aiogames:aiogames123@localhost:27017/aiogames|' .env
    rm .env.bak 2>/dev/null || true
    echo "✅ .env file created for development"
fi

echo "🐳 Starting MongoDB container..."
docker-compose -f docker-compose.dev.yml up -d mongodb-dev

echo "⏳ Waiting for MongoDB to be ready..."
timeout=60
counter=0
while ! docker exec aiogames-mongodb-dev mongosh --quiet --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
    if [ $counter -ge $timeout ]; then
        echo "❌ MongoDB failed to start within $timeout seconds"
        exit 1
    fi
    sleep 1
    ((counter++))
    if [ $((counter % 10)) -eq 0 ]; then
        echo "   Still waiting... ($counter/$timeout seconds)"
    fi
done

echo "✅ MongoDB is ready!"

# Show connection info
echo ""
echo "📊 Development Environment Info:"
echo "================================"
echo "🍃 MongoDB:         mongodb://localhost:27017"
echo "🔐 MongoDB Admin:   admin/dev123"
echo "🎯 App Database:    aiogames (user: aiogames/aiogames123)"
echo "🌐 Mongo Express:   http://localhost:8081 (admin/admin)"
echo "📱 Your App:        npm run dev (will run on http://localhost:3000)"
echo ""

# Show admin user info from environment
if [ -f ".env" ]; then
    ADMIN_EMAIL=$(grep ADMIN_EMAIL .env | cut -d '=' -f2)
    ADMIN_PASSWORD=$(grep ADMIN_PASSWORD .env | cut -d '=' -f2)
    if [ ! -z "$ADMIN_EMAIL" ] && [ ! -z "$ADMIN_PASSWORD" ]; then
        echo "🔑 Admin User (auto-created on first app start):"
        echo "   Email:    $ADMIN_EMAIL"
        echo "   Password: $ADMIN_PASSWORD"
        echo "   Dashboard: http://localhost:3000/admin"
        echo ""
    fi
fi

# Ask if user wants to start Mongo Express
read -p "Start MongoDB web interface? (y/N): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Starting MongoDB Express..."
    docker-compose -f docker-compose.dev.yml up -d mongo-express-dev
    echo "✅ MongoDB Express available at http://localhost:8081"
fi

echo ""
echo "🎯 Next Steps:"
echo "=============="
echo "1. Run 'npm run dev' to start your application"
echo "2. Visit http://localhost:3000 to use your app"
echo "3. Visit http://localhost:8081 to manage MongoDB (if started)"
echo ""
echo "💡 Commands:"
echo "   npm run dev                          # Start development server"
echo "   docker-compose -f docker-compose.dev.yml ps    # Check container status"
echo "   docker-compose -f docker-compose.dev.yml logs  # View MongoDB logs"
echo "   docker-compose -f docker-compose.dev.yml down  # Stop all containers"
echo ""

# Show container status
echo "📦 Container Status:"
docker-compose -f docker-compose.dev.yml ps