#!/bin/bash

# 🚀 AIOgames Production Deployment Script
# This script helps deploy AIOgames in production environments

set -e

echo "🚀 AIOgames Production Deployment"
echo "================================="
echo

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are available"
echo

# Environment configuration
if [ ! -f .env ]; then
    echo "🔧 Setting up environment configuration..."
    if [ ! -f .env.example ]; then
        echo "❌ .env.example not found. Please ensure all files are present."
        exit 1
    fi
    
    cp .env.example .env
    echo "✅ Created .env from template"
    echo
    echo "🚨 IMPORTANT: Configure your .env file before proceeding!"
    echo "   1. Set your domain: NEXTAUTH_URL=https://yourdomain.com"
    echo "   2. Set secure secret: NEXTAUTH_SECRET=your-secure-secret"
    echo "   3. Configure MongoDB: MONGODB_URI=mongodb+srv://..."
    echo
    echo "💡 Generate secure secret: openssl rand -base64 32"
    echo
    read -p "Press Enter after configuring .env file..."
else
    echo "✅ Environment file exists"
fi

# Validate environment
echo "🔍 Validating environment configuration..."

if grep -q "your-super-secret-nextauth-secret-change-this-in-production" .env; then
    echo "⚠️  WARNING: NEXTAUTH_SECRET is still default. Please change it!"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

if grep -q "yourdomain.com" .env; then
    echo "⚠️  WARNING: NEXTAUTH_URL is still default. Please set your domain!"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "✅ Environment validation completed"
echo

# Choose deployment type
echo "🎯 Select deployment configuration:"
echo "1) Production (MongoDB Atlas) - Recommended"
echo "2) Development (Local MongoDB) - For testing"
read -p "Enter choice [1-2]: " -n 1 -r
echo

case $REPLY in
    1)
        COMPOSE_FILE="docker-compose.production.yml"
        echo "✅ Using production configuration"
        ;;
    2)
        COMPOSE_FILE="docker-compose.development.yml"
        echo "✅ Using development configuration"
        echo "⚠️  This includes a local MongoDB container"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

# Build and deploy
echo
echo "🔧 Preparing deployment..."

# Clean up any existing containers
echo "🧹 Cleaning up existing containers..."
docker-compose -f $COMPOSE_FILE down 2>/dev/null || true

# Build fresh images
echo "📦 Building application..."
docker-compose -f $COMPOSE_FILE build --no-cache

# Start services
echo "🚀 Starting services..."
docker-compose -f $COMPOSE_FILE up -d

# Wait for application to be ready
echo "⏳ Waiting for application to start..."
sleep 15

# Health check
echo "🏥 Performing health check..."
for i in {1..30}; do
    if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
        echo "✅ Application is healthy!"
        break
    else
        if [ $i -eq 30 ]; then
            echo "⚠️  Application health check timed out"
            echo "📝 Check logs: docker-compose -f $COMPOSE_FILE logs"
        else
            sleep 2
        fi
    fi
done

echo
echo "🎉 Deployment completed!"
echo "======================="
echo
echo "🌐 Application URL: http://localhost:3000"
echo "🏥 Health Check:    http://localhost:3000/api/health"
echo "🔐 Admin Panel:     http://localhost:3000/admin"
echo
echo "📝 Useful commands:"
echo "   View logs:    docker-compose -f $COMPOSE_FILE logs -f"
echo "   Stop:         docker-compose -f $COMPOSE_FILE down"
echo "   Restart:      docker-compose -f $COMPOSE_FILE restart"
echo "   Shell access: docker-compose -f $COMPOSE_FILE exec aiogames sh"
echo

# Show container status
echo "📊 Container Status:"
docker-compose -f $COMPOSE_FILE ps

echo
echo "🚀 AIOgames is now running!"

# First-time setup reminder
echo
echo "🎯 First-time setup:"
if [ "$REPLY" = "1" ]; then
    echo "   1. Visit your application URL"
    echo "   2. Register an admin account or visit /api/admin/seed"
    echo "   3. Configure your domain in .env for production"
    echo "   4. Set up reverse proxy with SSL for production"
else
    echo "   1. Visit http://localhost:3000"
    echo "   2. Register a new account"
    echo "   3. MongoDB is available at localhost:27017"
    echo "   4. MongoDB Express: http://localhost:8081 (if enabled)"
fi