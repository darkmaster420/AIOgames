#!/bin/bash

echo "🔧 AIOgames Production Deployment Troubleshooter"
echo "================================================"

# Function to test different deployment methods
test_deployment() {
    local method=$1
    local dockerfile=$2
    
    echo ""
    echo "🧪 Testing deployment method: $method"
    echo "Using Dockerfile: $dockerfile"
    
    # Build the image
    echo "📦 Building Docker image..."
    if docker build -f "$dockerfile" -t aiogames-test:$method .; then
        echo "✅ Build successful"
        
        # Test the image
        echo "🚀 Testing the image..."
        docker run -d --name aiogames-test-$method -p 3001:3000 \
            -e NODE_ENV=production \
            -e NEXTAUTH_URL=http://localhost:3001 \
            -e NEXTAUTH_SECRET=test-secret \
            -e MONGODB_URI=mongodb://localhost:27017/aiogames \
            aiogames-test:$method
        
        # Wait a moment for startup
        sleep 10
        
        # Test if it's working
        if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
            echo "✅ Health check passed for $method"
            
            # Test if CSS is loading
            if curl -s http://localhost:3001 | grep -q "_next/static"; then
                echo "✅ Static assets detected for $method"
            else
                echo "❌ Static assets not found for $method"
            fi
        else
            echo "❌ Health check failed for $method"
        fi
        
        # Show logs
        echo "📝 Last 10 log lines for $method:"
        docker logs --tail 10 aiogames-test-$method
        
        # Cleanup
        docker stop aiogames-test-$method
        docker rm aiogames-test-$method
        
    else
        echo "❌ Build failed for $method"
    fi
}

echo "This script will test different deployment configurations to find the issue."
echo "Make sure you have Docker running and port 3001 available."
echo ""
read -p "Press Enter to continue..."

# Test 1: Current standalone method
test_deployment "standalone" "Dockerfile.prod"

# Test 2: Non-standalone method  
test_deployment "regular" "Dockerfile.alt"

echo ""
echo "🏁 Testing complete!"
echo "Use the method that worked best for your production deployment."