# =========================
# 1. Build Frontend (React)
# =========================
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build


# =========================
# 2. Backend + Frontend Serve
# =========================
FROM node:20-alpine

WORKDIR /app

# Copy backend package.json
COPY backend/package*.json ./backend/

# Install backend deps (socket.io, express, sqlite3, etc.)
WORKDIR /app/backend
RUN npm install

# Copy backend source
COPY backend ./ 

# Copy built frontend from previous stage
COPY --from=frontend-build /app/frontend/dist ./public

# Expose backend port
EXPOSE 2000

# Start backend
CMD ["node", "src/index.js"]