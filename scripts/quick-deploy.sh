#!/bin/bash

# AIOgames Quick Deploy Script
# This script helps users deploy AIOgames using the published Docker image

set -e

echo "🚀 AIOgames Quick Deploy"
echo "======================="

# Check if Docker and Docker Compose are installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create directory for deployment
DEPLOY_DIR="aiogames-deploy"
if [ ! -d "$DEPLOY_DIR" ]; then
    echo "📁 Creating deployment directory..."
    mkdir -p "$DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"

# Download necessary files
echo "⬇️  Downloading configuration files..."

# Download docker-compose.prod.yml
if [ ! -f "docker-compose.yml" ]; then
    curl -o docker-compose.yml https://raw.githubusercontent.com/darkmaster420/AIOgames/main/docker-compose.prod.yml
fi

# Download .env.example
if [ ! -f ".env.example" ]; then
    curl -o .env.example https://raw.githubusercontent.com/darkmaster420/AIOgames/main/.env.example
fi

# Download MongoDB init script
mkdir -p docker
if [ ! -f "docker/mongo-init.js" ]; then
    curl -o docker/mongo-init.js https://raw.githubusercontent.com/darkmaster420/AIOgames/main/docker/mongo-init.js
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating environment file..."
    cp .env.example .env
    
    # Generate a random NextAuth secret
    NEXTAUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    sed -i.bak "s/your-super-secure-secret-key-change-this-in-production/$NEXTAUTH_SECRET/" .env
    
    # Generate random MongoDB passwords
    MONGO_ROOT_PASSWORD=$(openssl rand -base64 16 2>/dev/null || head -c 16 /dev/urandom | base64)
    MONGO_EXPRESS_PASSWORD=$(openssl rand -base64 12 2>/dev/null || head -c 12 /dev/urandom | base64)
    
    echo "" >> .env
    echo "# Auto-generated MongoDB passwords" >> .env
    echo "MONGO_ROOT_PASSWORD=$MONGO_ROOT_PASSWORD" >> .env
    echo "MONGO_EXPRESS_PASSWORD=$MONGO_EXPRESS_PASSWORD" >> .env
    
    # Set local MongoDB URI
    sed -i.bak "s|mongodb+srv://your-username:your-password@cluster0.xxxxx.mongodb.net/aiogames?retryWrites=true&w=majority|mongodb://aiogames:aiogames123@mongodb:27017/aiogames|" .env
    
    echo "✅ Environment file created with random passwords"
    rm .env.bak 2>/dev/null || true
fi

echo ""
echo "🔧 Configuration:"
echo "=================="
echo "📍 Deployment directory: $(pwd)"
echo "🌐 Application will be available at: http://localhost:3000"
echo "🍃 MongoDB will be available at: localhost:27017"
echo "🔍 MongoDB Express (optional): http://localhost:8081"
echo ""

# Ask user about deployment type
echo "Choose deployment type:"
echo "1) MongoDB Atlas (recommended for production)"
echo "2) Local MongoDB (good for testing)"
echo "3) Continue with current .env settings"
read -p "Enter choice [1-3]: " -n 1 -r
echo ""

case $REPLY in
    1)
        echo "📝 Please edit the .env file and set your MongoDB Atlas connection string:"
        echo "   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/aiogames"
        echo ""
        echo "Press Enter when ready to continue..."
        read
        ;;
    2)
        echo "✅ Using local MongoDB setup"
        ;;
    3)
        echo "✅ Using current configuration"
        ;;
    *)
        echo "Invalid choice, using current configuration"
        ;;
esac

# Pull the latest image
echo "📦 Pulling latest AIOgames image..."
docker pull ghcr.io/darkmaster420/aiogames:latest

# Start the application
echo "🚀 Starting AIOgames..."

if [[ "$REPLY" == "2" ]]; then
    docker-compose up -d
else
    # Start without MongoDB
    docker-compose up -d aiogames
fi

echo ""
echo "✅ AIOgames is starting up!"
echo ""
echo "📊 Status: docker-compose ps"
echo "📋 Logs:   docker-compose logs -f"
echo "🛑 Stop:   docker-compose down"
echo ""
echo "🌐 Open http://localhost:3000 in your browser"
echo ""

# Show status
sleep 3
docker-compose ps