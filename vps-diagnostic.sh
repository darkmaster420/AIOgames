#!/bin/bash

echo "🔍 AIOgames VPS Deployment Diagnostics"
echo "======================================"

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    if [ "$status" = "OK" ]; then
        echo "✅ $message"
    elif [ "$status" = "ERROR" ]; then
        echo "❌ $message"
    elif [ "$status" = "WARNING" ]; then
        echo "⚠️  $message"
    else
        echo "ℹ️  $message"
    fi
}

# Get container info
CONTAINER_NAME="aiogames-app"  # Adjust this to your container name

# Check if container is running
if docker ps | grep -q "$CONTAINER_NAME"; then
    print_status "OK" "Container $CONTAINER_NAME is running"
    
    # Get container image info
    IMAGE=$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null)
    print_status "INFO" "Using image: $IMAGE"
    
    # Check logs for errors
    echo ""
    echo "🔍 Container Logs (last 20 lines):"
    echo "======================================"
    docker logs --tail 20 "$CONTAINER_NAME"
    
    # Test health endpoint
    echo ""
    echo "🔍 Health Check:"
    echo "=================="
    HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null)
    if [ "$HEALTH_STATUS" = "200" ]; then
        print_status "OK" "Health endpoint responding (HTTP $HEALTH_STATUS)"
    else
        print_status "ERROR" "Health endpoint not responding (HTTP $HEALTH_STATUS)"
    fi
    
    # Test main page
    echo ""
    echo "🔍 Main Page Test:"
    echo "=================="
    MAIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null)
    print_status "INFO" "Main page HTTP status: $MAIN_STATUS"
    
    # Check if HTML contains CSS references
    echo ""
    echo "🔍 CSS References in HTML:"
    echo "=========================="
    HTML_OUTPUT=$(curl -s http://localhost:3000/auth/signin 2>/dev/null)
    if echo "$HTML_OUTPUT" | grep -q "_next/static.*\.css"; then
        print_status "OK" "CSS references found in HTML"
        CSS_FILE=$(echo "$HTML_OUTPUT" | grep -o '_next/static[^"]*\.css' | head -1)
        print_status "INFO" "CSS file: $CSS_FILE"
        
        # Test CSS file accessibility
        CSS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/$CSS_FILE" 2>/dev/null)
        if [ "$CSS_STATUS" = "200" ]; then
            print_status "OK" "CSS file accessible (HTTP $CSS_STATUS)"
        else
            print_status "ERROR" "CSS file not accessible (HTTP $CSS_STATUS)"
        fi
    else
        print_status "ERROR" "No CSS references found in HTML"
    fi
    
    # Check static files in container
    echo ""
    echo "🔍 Static Files in Container:"
    echo "============================="
    if docker exec "$CONTAINER_NAME" ls .next/static/chunks/*.css >/dev/null 2>&1; then
        print_status "OK" "CSS files exist in container"
        docker exec "$CONTAINER_NAME" ls -la .next/static/chunks/*.css
    else
        print_status "ERROR" "No CSS files found in container"
    fi
    
    # Check environment variables
    echo ""
    echo "🔍 Environment Variables:"
    echo "========================="
    docker exec "$CONTAINER_NAME" env | grep -E "(NODE_ENV|NEXTAUTH_URL|PORT)" | while read line; do
        print_status "INFO" "$line"
    done
    
    # Check if JavaScript is working
    echo ""
    echo "🔍 JavaScript Test:"
    echo "==================="
    if echo "$HTML_OUTPUT" | grep -q "_next/static.*\.js"; then
        print_status "OK" "JavaScript references found in HTML"
        JS_FILE=$(echo "$HTML_OUTPUT" | grep -o '_next/static[^"]*\.js' | head -1)
        JS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/$JS_FILE" 2>/dev/null)
        if [ "$JS_STATUS" = "200" ]; then
            print_status "OK" "JavaScript file accessible (HTTP $JS_STATUS)"
        else
            print_status "ERROR" "JavaScript file not accessible (HTTP $JS_STATUS)"
        fi
    else
        print_status "ERROR" "No JavaScript references found in HTML"
    fi
    
    # Test with different user agent (sometimes matters)
    echo ""
    echo "🔍 Browser Simulation Test:"
    echo "==========================="
    BROWSER_HTML=$(curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" http://localhost:3000/auth/signin 2>/dev/null)
    if echo "$BROWSER_HTML" | grep -q "_next/static.*\.css"; then
        print_status "OK" "CSS loaded with browser user-agent"
    else
        print_status "ERROR" "CSS not loaded with browser user-agent"
    fi
    
else
    print_status "ERROR" "Container $CONTAINER_NAME is not running"
    echo ""
    echo "Available containers:"
    docker ps -a
fi

echo ""
echo "🎯 Next Steps Based on Results:"
echo "==============================="
echo "1. If CSS files exist but aren't accessible via HTTP:"
echo "   - Check if Next.js is serving static files correctly"
echo "   - Verify the container port mapping (3000:3000)"
echo ""
echo "2. If CSS files don't exist in container:"
echo "   - The build process didn't include CSS files"
echo "   - Try rebuilding with: docker-compose build --no-cache"
echo ""
echo "3. If everything looks OK but browser shows no styling:"
echo "   - Check browser dev tools Network tab for failed requests"
echo "   - Try clearing browser cache"
echo "   - Check if a reverse proxy is interfering"
echo ""
echo "4. If using a reverse proxy (nginx, traefik, etc.):"
echo "   - Ensure static files (/_next/static/*) are passed through"
echo "   - Check proxy logs for 404s on static files"

echo ""
echo "📝 Run this script on your VPS to diagnose the issue!"