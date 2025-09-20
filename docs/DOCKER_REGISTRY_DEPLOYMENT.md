# Docker Deployment Guide

AIOgames provides pre-built Docker images for easy deployment. This guide covers multiple deployment options using the published Docker images.

## 🚀 Quick Start (Recommended)

The easiest way to deploy AIOgames is using our quick deployment script:

```bash
# Download and run the quick deploy script
curl -sSL https://raw.githubusercontent.com/darkmaster420/AIOgames/main/scripts/quick-deploy.sh | bash
```

This script will:
- Download all necessary configuration files
- Create a secure `.env` file with random passwords
- Pull the latest Docker image
- Start the application

## 📦 Published Docker Images

Docker images are automatically built and published to GitHub Container Registry:

- **Latest stable**: `ghcr.io/darkmaster420/aiogames:latest`
- **Version tags**: `ghcr.io/darkmaster420/aiogames:v1.0.0`
- **Development**: `ghcr.io/darkmaster420/aiogames:main`

### Supported Architectures
- `linux/amd64` (Intel/AMD)
- `linux/arm64` (ARM, Apple Silicon)

## 🐳 Manual Deployment Options

### Option 1: Using Docker Compose (Recommended)

1. **Create deployment directory:**
```bash
mkdir aiogames && cd aiogames
```

2. **Download configuration:**
```bash
# Download docker-compose file
curl -o docker-compose.yml https://raw.githubusercontent.com/darkmaster420/AIOgames/main/docker-compose.prod.yml

# Download environment template
curl -o .env.example https://raw.githubusercontent.com/darkmaster420/AIOgames/main/.env.example
```

3. **Configure environment:**
```bash
cp .env.example .env
nano .env  # Edit with your settings
```

4. **Start services:**
```bash
# With local MongoDB
docker-compose up -d

# Or without MongoDB (using Atlas)
docker-compose up -d aiogames
```

### Option 2: Simple Docker Run

For basic deployment without MongoDB:

```bash
docker run -d \
  --name aiogames \
  -p 3000:3000 \
  -e MONGODB_URI="your-mongodb-connection-string" \
  -e NEXTAUTH_SECRET="your-secure-secret" \
  -e NEXTAUTH_URL="http://localhost:3000" \
  ghcr.io/darkmaster420/aiogames:latest
```

## ⚙️ Environment Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.net/aiogames` |
| `NEXTAUTH_SECRET` | JWT signing secret | `your-secure-random-secret` |
| `NEXTAUTH_URL` | Application base URL | `http://localhost:3000` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GAME_API_URL` | Game API endpoint | `https://gameapi.a7a8524.workers.dev` |
| `NODE_ENV` | Runtime environment | `production` |

### Example .env File

```bash
# Database - MongoDB Atlas (recommended)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/aiogames

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-super-secure-secret-key

# Game API
GAME_API_URL=https://gameapi.a7a8524.workers.dev

# App Settings
NODE_ENV=production
```

## 🗄️ Database Options

### MongoDB Atlas (Recommended)

1. Create a free MongoDB Atlas account
2. Create a cluster and database user
3. Whitelist your server's IP address
4. Use the connection string in `MONGODB_URI`

### Local MongoDB

The `docker-compose.prod.yml` includes a local MongoDB setup:

```bash
# Start with local MongoDB
docker-compose up -d

# Access MongoDB
docker exec -it aiogames-mongodb mongosh

# Access web interface (optional)
# http://localhost:8081
```

## 🔒 Security Considerations

### Production Checklist

- [ ] Change default `NEXTAUTH_SECRET` to a secure random value
- [ ] Use MongoDB Atlas or secure your local MongoDB
- [ ] Configure firewall rules (ports 3000, 27017, 8081)
- [ ] Use HTTPS in production (reverse proxy recommended)
- [ ] Regularly update Docker images
- [ ] Monitor container logs

### Recommended Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 📊 Monitoring & Maintenance

### Health Checks

The Docker image includes built-in health checks:

```bash
# Check container health
docker ps

# View health check logs
docker inspect aiogames | grep -A 10 "Health"
```

### Logs

```bash
# View application logs
docker-compose logs -f aiogames

# View MongoDB logs
docker-compose logs -f mongodb
```

### Updates

```bash
# Pull latest image
docker pull ghcr.io/darkmaster420/aiogames:latest

# Restart with new image
docker-compose down
docker-compose up -d
```

### Backups

```bash
# Backup MongoDB data
docker exec aiogames-mongodb mongodump --out /backup

# Copy backup from container
docker cp aiogames-mongodb:/backup ./mongodb-backup
```

## 🔧 Troubleshooting

### Common Issues

1. **Container won't start:**
   - Check environment variables
   - Verify MongoDB connection
   - Check Docker logs

2. **Database connection failed:**
   - Verify `MONGODB_URI` format
   - Check network connectivity
   - Confirm database credentials

3. **Application errors:**
   - Check `NEXTAUTH_SECRET` is set
   - Verify all required environment variables
   - Check application logs

### Debug Commands

```bash
# Check container status
docker-compose ps

# View detailed logs
docker-compose logs --details

# Access container shell
docker exec -it aiogames sh

# Test database connection
docker exec -it aiogames-mongodb mongosh aiogames
```

## 🆙 Migration from Source Build

If you're currently building from source:

1. **Export your data** (if needed)
2. **Stop current containers**
3. **Update to published image deployment**
4. **Import your data** (if needed)

```bash
# Stop source build
docker-compose down

# Switch to published image
curl -sSL https://raw.githubusercontent.com/darkmaster420/AIOgames/main/scripts/quick-deploy.sh | bash
```

## 📞 Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/darkmaster420/AIOgames/issues)
- **Discussions**: [Community support](https://github.com/darkmaster420/AIOgames/discussions)
- **Documentation**: [Full documentation](https://github.com/darkmaster420/AIOgames/docs)

---

*Updated: December 2024 | AIOgames v1.0*