#!/bin/bash

# Update checker script for AIOgames
# This script should be run periodically (e.g., every 6 hours) using cron

API_URL="http://localhost:3001/api/updates/check"

echo "$(date): Starting update check..."

# Make the API request
response=$(curl -s -X POST "$API_URL" -w "%{http_code}")
http_code="${response: -3}"
body="${response%???}"

if [ "$http_code" = "200" ]; then
    echo "$(date): Update check completed successfully"
    echo "Response: $body"
else
    echo "$(date): Update check failed with HTTP $http_code"
    echo "Response: $body"
fi

echo "$(date): Update check finished"
echo "---"