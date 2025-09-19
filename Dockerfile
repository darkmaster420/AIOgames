# =========================
# 1. Build Frontend (React)
# =========================
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./

# Install all dependencies including dev dependencies for building
RUN npm install

# Copy source and build
COPY frontend/ ./
RUN npm run build

# Clean up dev dependencies
RUN npm ci --omit=dev

# =========================
# 2. Backend Build
# =========================
FROM node:20-alpine AS backend-build

WORKDIR /app/backend
COPY backend/package*.json ./

# Install dependencies
RUN npm install && npm ci --omit=dev

# Copy source
COPY backend/ ./

# =========================
# 3. Final Image
# =========================
FROM node:20-alpine

# Install required system packages
RUN apk add --no-cache \
    aria2 \
    qbittorrent-nox \
    supervisor \
    wget \
    curl \
    python3 \
    openjdk11-jre-headless

# Create app directory and user
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create required directories and files with proper permissions
RUN mkdir -p /app/logs /app/downloads /app/config && \
    touch /app/data.db && \
    chown -R appuser:appgroup /app

# Download JDownloader
RUN wget -O JDownloader.jar https://installer.jdownloader.org/JDownloader.jar && \
    mv JDownloader.jar /app/JDownloader.jar && \
    chown appuser:appgroup /app/JDownloader.jar && \
    chmod +x /app/JDownloader.jar

# Copy backend and frontend from their build stages
COPY --from=backend-build --chown=appuser:appgroup /app/backend /app/
COPY --from=frontend-build --chown=appuser:appgroup /app/frontend/dist /app/frontend/dist

# Copy supervisord config and init script
COPY --chown=appuser:appgroup supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chown=appuser:appgroup init-services.sh /app/init-services.sh
RUN chmod +x /app/init-services.sh

# Create volume mount points
VOLUME ["/app/data", "/app/downloads", "/app/config", "/app/logs"]

# Switch to appuser
USER appuser

# Start supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

# Expose ports
EXPOSE 2000 6800 8080 3000

# Set environment
ENV NODE_ENV=production \
    ARIA2_HOST=localhost \
    ARIA2_PORT=6800

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --spider http://localhost:4000/health || exit 1