#!/bin/sh

# Create necessary directories
mkdir -p /app/logs /downloads /downloads/temp

# Set permissions
chown -R appuser:appgroup /app/logs /downloads /downloads/temp /config

# Configure JDownloader credentials
if [ ! -f /config/jd2/cfg/org.jdownloader.api.myjdownloader.MyJDownloaderSettings.json ]; then
    mkdir -p /config/jd2/cfg
    echo '{
        "email": "chinesehacker101@gmail.com",
        "password": "5rM6*EQwNUxm5_C",
        "devicename": "aiogames"
    }' > /config/jd2/cfg/org.jdownloader.api.myjdownloader.MyJDownloaderSettings.json
    chown appuser:appgroup /config/jd2/cfg/org.jdownloader.api.myjdownloader.MyJDownloaderSettings.json
fi

# Start supervisord
exec /usr/bin/supervisord -n -c /etc/supervisord.conf