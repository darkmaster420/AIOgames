#!/bin/bash

echo "🔍 AIOgames Docker Diagnostics"
echo "=============================="
echo ""

CONTAINER_NAME="aiogames-github"
BASE_URL="http://localhost:3002"

echo "1. Container Status:"
docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

echo "2. Health Check:"
curl -s "$BASE_URL/api/health" | jq . 2>/dev/null || curl -s "$BASE_URL/api/health"
echo ""

echo "3. CSS File Status:"
CSS_URL=$(curl -s "$BASE_URL/auth/signin" | grep -o '/_next/static/chunks/[^"]*\.css' | head -1)
if [ ! -z "$CSS_URL" ]; then
    echo "CSS URL found: $CSS_URL"
    echo "HTTP Status: $(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$CSS_URL")"
    echo "Content-Type: $(curl -s -I "$BASE_URL$CSS_URL" | grep -i content-type)"
    echo "CSS Size: $(curl -s "$BASE_URL$CSS_URL" | wc -c) bytes"
    echo ""
    echo "CSS Preview (first 500 chars):"
    curl -s "$BASE_URL$CSS_URL" | head -c 500
    echo "..."
else
    echo "❌ No CSS URL found in HTML!"
fi
echo ""

echo "4. HTML Structure Check:"
echo "Page title: $(curl -s "$BASE_URL/auth/signin" | grep -o '<title>[^<]*</title>')"
echo "Body classes: $(curl -s "$BASE_URL/auth/signin" | grep -o 'class="[^"]*"' | head -1)"
echo ""

echo "5. JavaScript Files:"
curl -s "$BASE_URL/auth/signin" | grep -o '/_next/static/chunks/[^"]*\.js' | head -3
echo ""

echo "6. Container Logs (last 10 lines):"
docker logs --tail 10 "$CONTAINER_NAME"
echo ""

echo "🔧 Troubleshooting Tips:"
echo "- Try hard refresh in browser (Ctrl+F5)"
echo "- Check browser developer tools for 404 errors"
echo "- Try incognito/private browsing mode"
echo "- Check if ad blockers are interfering"
echo ""
echo "If CSS file loads correctly but page still looks broken:"
echo "- Check browser console for JavaScript errors"
echo "- Verify network tab shows CSS file loaded successfully"
echo "- Try different browser or device"