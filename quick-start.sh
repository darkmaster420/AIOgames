#!/bin/bash

# AIOgames Production Quick Start Script
# This script helps you deploy AIOgames quickly

echo "🎮 AIOgames Production Deployment"
echo "================================="
echo

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

# Check if environment file exists
if [ ! -f ".env.local" ]; then
    echo "📋 Setting up environment configuration..."
    
    if [ -f ".env.production" ]; then
        cp .env.production .env.local
        echo "✅ Copied .env.production to .env.local"
    elif [ -f ".env.example" ]; then
        cp .env.example .env.local
        echo "✅ Copied .env.example to .env.local"
    else
        echo "❌ No environment template found. Please create .env.local manually."
        exit 1
    fi
    
    echo
    echo "⚠️  IMPORTANT: Edit .env.local with your configuration:"
    echo "   - MongoDB connection string"
    echo "   - GitHub OAuth credentials"
    echo "   - NextAuth secret key"
    echo "   - Production domain URL"
    echo
    read -p "Press Enter after configuring .env.local..."
fi

# Validate required environment variables
echo "🔍 Validating environment configuration..."

required_vars=("MONGODB_URI" "NEXTAUTH_SECRET" "GITHUB_CLIENT_ID" "GITHUB_CLIENT_SECRET")
missing_vars=()

for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" .env.local || grep -q "^${var}=$" .env.local || grep -q "^${var}=your-" .env.local; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo "❌ Missing or incomplete configuration for:"
    printf '   - %s\n' "${missing_vars[@]}"
    echo
    echo "Please edit .env.local and configure these variables."
    exit 1
fi

echo "✅ Environment configuration validated"

# Choose deployment method
echo
echo "🚀 Select deployment method:"
echo "1. Production deployment (recommended)"
echo "2. Development deployment"
echo "3. Build and test locally"

read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        echo "🏭 Starting production deployment..."
        docker compose -f docker-compose.production.yml down 2>/dev/null
        docker compose -f docker-compose.production.yml pull
        docker compose -f docker-compose.production.yml up -d
        
        if [ $? -eq 0 ]; then
            echo "✅ Production deployment successful!"
            echo
            echo "📊 Services started:"
            docker compose -f docker-compose.production.yml ps
            echo
            echo "🌐 Application should be available at:"
            echo "   http://localhost:3000"
            echo
            echo "📋 Useful commands:"
            echo "   View logs: docker compose -f docker-compose.production.yml logs -f"
            echo "   Stop services: docker compose -f docker-compose.production.yml down"
        else
            echo "❌ Production deployment failed. Check the logs:"
            echo "   docker compose -f docker-compose.production.yml logs"
        fi
        ;;
    2)
        echo "🔧 Starting development deployment..."
        docker compose -f docker-compose.development.yml down 2>/dev/null
        docker compose -f docker-compose.development.yml up -d
        
        if [ $? -eq 0 ]; then
            echo "✅ Development deployment successful!"
            echo
            echo "📊 Services started:"
            docker compose -f docker-compose.development.yml ps
            echo
            echo "🌐 Application should be available at:"
            echo "   http://localhost:3000"
            echo
            echo "📋 Useful commands:"
            echo "   View logs: docker compose -f docker-compose.development.yml logs -f"
            echo "   Stop services: docker compose -f docker-compose.development.yml down"
        else
            echo "❌ Development deployment failed. Check the logs:"
            echo "   docker compose -f docker-compose.development.yml logs"
        fi
        ;;
    3)
        echo "🔨 Building and testing locally..."
        
        # Check if Node.js is installed
        if ! command -v node &> /dev/null; then
            echo "❌ Node.js is not installed. Please install Node.js 18+ first."
            exit 1
        fi
        
        # Install dependencies
        echo "📦 Installing dependencies..."
        npm ci
        
        if [ $? -ne 0 ]; then
            echo "❌ Failed to install dependencies"
            exit 1
        fi
        
        # Build application
        echo "🏗️ Building application..."
        npm run build
        
        if [ $? -eq 0 ]; then
            echo "✅ Build successful!"
            echo
            echo "🚀 To start the production server:"
            echo "   npm start"
            echo
            echo "🔧 To start development server:"
            echo "   npm run dev"
        else
            echo "❌ Build failed. Please check the error messages above."
        fi
        ;;
    *)
        echo "❌ Invalid choice. Please run the script again and select 1, 2, or 3."
        exit 1
        ;;
esac

echo
echo "🎉 Deployment complete!"
echo "📖 For more information, see:"
echo "   - README.md - General documentation"
echo "   - PRODUCTION_READY.md - Production deployment guide"
echo "   - AUTOMATIC_SCHEDULER.md - Automatic update system details"