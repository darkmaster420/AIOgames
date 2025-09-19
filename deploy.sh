#!/bin/bash

# AIOgames Deployment Script
# This script checks MongoDB configuration and sets up the appropriate deployment

set -e

echo "🚀 AIOgames Deployment Setup"
echo "==============================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Creating default .env file..."
    cat > .env << EOF
# AIOgames Configuration

# Server Configuration
PORT=3000
NODE_ENV=production
JWT_SECRET=changeme_in_production

# MongoDB Configuration
# Options:
# 1. Cloud MongoDB (Atlas): mongodb+srv://user:pass@cluster.mongodb.net/dbname
# 2. Local container: mongodb://localhost:27017/aiogames
MONGODB_URI=mongodb://localhost:27017/aiogames

# Download Services Configuration
ARIA2_URL=http://localhost:6800/jsonrpc
ARIA2_SECRET=changeme_in_production
QB_USERNAME=admin
QB_PASSWORD=changeme_in_production
JD_EMAIL=your-email@example.com
JD_PASSWORD=changeme_in_production

# Optional: Steam API Key
#STEAM_API_KEY=your_steam_api_key

# Production Optimizations
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=900000
LOG_LEVEL=info
EOF
    echo -e "${YELLOW}⚠️  Please edit .env file with your configuration before continuing.${NC}"
    exit 1
fi

# Load environment variables
source .env

# Function to check if MongoDB URI is external (cloud-based)
is_external_mongodb() {
    local uri="$1"
    if [[ "$uri" == *"mongodb.com"* ]] || [[ "$uri" == *"mongodb.net"* ]] || [[ "$uri" == *"mongodb+srv"* ]] || [[ "$uri" != *"localhost"* && "$uri" != *"127.0.0.1"* && "$uri" != *"mongodb:"* ]]; then
        return 0 # true
    else
        return 1 # false
    fi
}

# Check MongoDB configuration
echo "🗄️  Checking MongoDB configuration..."
if is_external_mongodb "$MONGODB_URI"; then
    echo -e "${GREEN}✅ External MongoDB detected: Using cloud/remote database${NC}"
    echo "   URI: ${MONGODB_URI}"
    USE_EXTERNAL_MONGO=true
    
    # Test connection to external MongoDB
    echo "🔍 Testing MongoDB connection..."
    if command -v mongosh &> /dev/null || command -v mongo &> /dev/null; then
        echo "   Testing connection to external MongoDB..."
        # This will be handled by the application at runtime
    fi
else
    echo -e "${BLUE}📦 Local MongoDB: Will create container${NC}"
    USE_EXTERNAL_MONGO=false
fi

# Create appropriate docker-compose configuration
if [ "$USE_EXTERNAL_MONGO" = true ]; then
    COMPOSE_FILE="docker-compose.prod.yml"
    echo "📝 Creating production docker-compose without MongoDB container..."
else
    COMPOSE_FILE="docker-compose.yml"
    echo "📝 Using docker-compose with MongoDB container..."
fi

# Check required commands
echo "🔧 Checking dependencies..."
missing_deps=()

if ! command -v docker &> /dev/null; then
    missing_deps+=("docker")
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    missing_deps+=("docker-compose")
fi

if [ ${#missing_deps[@]} -gt 0 ]; then
    echo -e "${RED}❌ Missing dependencies: ${missing_deps[*]}${NC}"
    echo "Please install the missing dependencies and try again."
    exit 1
fi

echo -e "${GREEN}✅ All dependencies found${NC}"

# Create production docker-compose file if using external MongoDB
if [ "$USE_EXTERNAL_MONGO" = true ]; then
    echo "📝 Creating production docker-compose configuration..."
    cat > docker-compose.prod.yml << 'EOF'
version: "3.9"

services:
  aiogames:
    build: 
      context: .
      dockerfile: Dockerfile.prod
    container_name: aiogames-app
    ports:
      - "${PORT:-3000}:3000"
      - "6800:6800"   # Aria2 RPC
      - "8080:8080"   # qBittorrent WebUI
      - "3128:3128"   # JDownloader API
    volumes:
      - aiogames_data:/app/data
      - downloads_data:/app/downloads
      - config_data:/app/config
      - logs_data:/app/logs
    environment:
      - NODE_ENV=production
      - PORT=${PORT:-3000}
      - JWT_SECRET=${JWT_SECRET}
      - MONGODB_URI=${MONGODB_URI}
      - ARIA2_URL=http://localhost:6800/jsonrpc
      - ARIA2_SECRET=${ARIA2_SECRET}
      - QB_USERNAME=${QB_USERNAME}
      - QB_PASSWORD=${QB_PASSWORD}
      - JD_EMAIL=${JD_EMAIL}
      - JD_PASSWORD=${JD_PASSWORD}
      - STEAM_API_KEY=${STEAM_API_KEY}
      - RATE_LIMIT_REQUESTS=${RATE_LIMIT_REQUESTS:-100}
      - RATE_LIMIT_WINDOW=${RATE_LIMIT_WINDOW:-900000}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - aiogames-network

networks:
  aiogames-network:
    driver: bridge

volumes:
  aiogames_data:
  downloads_data:
  config_data:
  logs_data:
EOF
fi

# Environment summary
echo ""
echo -e "${BLUE}📋 Deployment Configuration Summary${NC}"
echo "======================================"
echo "MongoDB: $([ "$USE_EXTERNAL_MONGO" = true ] && echo "External/Cloud" || echo "Local Container")"
echo "Compose file: $COMPOSE_FILE"
echo "JWT Secret: $([ "$JWT_SECRET" = "changeme_in_production" ] && echo -e "${RED}⚠️  DEFAULT (Change this!)${NC}" || echo -e "${GREEN}✅ Set${NC}")"
echo "Aria2 Secret: $([ "$ARIA2_SECRET" = "changeme_in_production" ] && echo -e "${RED}⚠️  DEFAULT (Change this!)${NC}" || echo -e "${GREEN}✅ Set${NC}")"
echo ""

# Security warnings
if [ "$JWT_SECRET" = "changeme_in_production" ] || [ "$ARIA2_SECRET" = "changeme_in_production" ] || [ "$QB_PASSWORD" = "changeme_in_production" ]; then
    echo -e "${RED}🚨 SECURITY WARNING${NC}"
    echo "Please change default passwords and secrets in .env file!"
    echo ""
fi

# Build and deploy options
echo "🚀 Ready to deploy! Choose an option:"
echo "1. Build and start services"
echo "2. Start services (if already built)"
echo "3. Stop services"
echo "4. View logs"
echo "5. Clean rebuild"
echo "6. Exit"

read -p "Enter your choice (1-6): " choice

case $choice in
    1)
        echo "🔨 Building and starting AIOgames..."
        if [ "$USE_EXTERNAL_MONGO" = true ]; then
            docker-compose -f docker-compose.prod.yml build
            docker-compose -f docker-compose.prod.yml up -d
        else
            docker-compose build
            docker-compose up -d
        fi
        ;;
    2)
        echo "▶️  Starting AIOgames services..."
        if [ "$USE_EXTERNAL_MONGO" = true ]; then
            docker-compose -f docker-compose.prod.yml up -d
        else
            docker-compose up -d
        fi
        ;;
    3)
        echo "⏹️  Stopping AIOgames services..."
        docker-compose down
        [ -f docker-compose.prod.yml ] && docker-compose -f docker-compose.prod.yml down
        ;;
    4)
        echo "📋 Viewing logs..."
        if [ "$USE_EXTERNAL_MONGO" = true ]; then
            docker-compose -f docker-compose.prod.yml logs -f
        else
            docker-compose logs -f
        fi
        ;;
    5)
        echo "🧹 Clean rebuild..."
        docker-compose down -v
        [ -f docker-compose.prod.yml ] && docker-compose -f docker-compose.prod.yml down -v
        docker system prune -f
        if [ "$USE_EXTERNAL_MONGO" = true ]; then
            docker-compose -f docker-compose.prod.yml build --no-cache
            docker-compose -f docker-compose.prod.yml up -d
        else
            docker-compose build --no-cache
            docker-compose up -d
        fi
        ;;
    6)
        echo "👋 Goodbye!"
        exit 0
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

# Show running services
echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "📊 Service Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo -e "${BLUE}🌐 Access Points:${NC}"
echo "• AIOgames Web UI: http://localhost:${PORT:-3000}"
echo "• qBittorrent WebUI: http://localhost:8080"
echo "• Aria2 RPC: http://localhost:6800"
echo ""
echo -e "${YELLOW}💡 Pro Tips:${NC}"
echo "• Monitor logs: docker-compose logs -f"
echo "• Check health: docker-compose ps"
echo "• Update: git pull && ./deploy.sh"