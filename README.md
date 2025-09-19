# AIOgames

An all-in-one container for managing game downloads with multiple download service support. The application provides a secure dashboard that displays game updates and allows users to manage downloads through various services like aria2, JDownloader, and qBittorrent. It integrates with a game search API to provide up-to-date game information and download options.

## 🚀 Quick Start

### One-Command Deployment
```bash
chmod +x ./deploy.sh && ./deploy.sh
```
The deployment script automatically detects your MongoDB configuration and sets up the appropriate environment.

### Manual Production Deployment
```bash
# Using external MongoDB (MongoDB.com, Atlas, etc.)
docker compose -f docker-compose.prod.yml up --build -d

# Using local MongoDB container
docker compose up --build -d
```

### Development Mode
```bash
# Start backend
cd backend && npm install && npm run dev

# Start frontend (in new terminal)
cd frontend && npm install && npm run dev
```

## 📱 Access Your Application

- **Web Interface**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **Aria2 RPC**: http://localhost:6801
- **qBittorrent Web UI**: http://localhost:8081
- **JDownloader API**: http://localhost:3129

Default login: `admin` / `admin`

## Overview

AIOgames is designed to be a comprehensive game management and download solution. It combines:
- A powerful game search and information system
- Multiple download service integrations (aria2, qBittorrent, JDownloader)
- Secure user authentication with JWT
- Real-time progress monitoring via WebSocket
- Mobile-responsive interface with dark mode
- Automated MongoDB deployment selection
- Production-ready Docker containerization
- Game tracking and update detection system

## Architecture

### Frontend
- React-based dashboard with mobile-first design
- Real-time updates using Socket.IO
- Responsive design with Tailwind CSS and dark mode
- Secure authentication handling
- Download progress visualization
- Mobile hamburger navigation

### Backend
- Node.js Express server with production static file serving
- MongoDB for data persistence (cloud or container)
- JWT-based authentication
- WebSocket support for real-time updates
- Multiple download service integrations with container networking
- Comprehensive error handling and connection retry logic

### Download Services (Dockerized)
- **aria2**: For HTTP/HTTPS/FTP downloads with RPC API
- **JDownloader**: For premium hosting sites and link decryption
- **qBittorrent**: For torrent downloads with web interface
- **Automatic service selection** based on link type and availability
- **Container networking** for reliable inter-service communication

### Game API Integration
- Search across multiple game sources (SkidrowReloaded, FreeGOGPCGames, GameDrive, SteamRip)
- Recent games feed with update detection
- Automatic download link processing and validation
- Support for encrypted links and premium hosters
- Image proxying to avoid CORS issues
- Game tracking system with version monitoring

## Features

- 🔒 **Secure Authentication**: JWT-based login system with admin user management
- 🎮 **Game Management**: Search, track, and monitor game updates across multiple sources
- 📥 **Multi-Downloader Support**:
  - **aria2** (HTTP/HTTPS/FTP downloads)
  - **qBittorrent** (Torrent downloads with web UI)
  - **JDownloader** (Premium hoster support)
- 📱 **Mobile-Responsive**: Optimized interface for phones, tablets, and desktops
- 🌙 **Dark Mode**: Full dark theme support with system preference detection
- 🔄 **Real-time Updates**: Live download progress and game update notifications
- 🐳 **Production Ready**: Multi-stage Docker builds with automated deployment
- 📊 **Storage Management**: Monitor disk usage and manage download locations
- 🔍 **Advanced Search**: Filter by source, date, and game type
- 📚 **Game Tracking**: Monitor favorite games for updates automatically
  - JDownloader (Premium hosting sites)
  - qBittorrent (Torrent files)
- 🔄 Automatic service detection
- 📊 Real-time download progress monitoring
- 🎯 User-friendly interface

### Optional Features

- 🎮 Steam Integration
  - Game metadata and updates from Steam Web API
  - Real-time update notifications
  - Build version tracking
  - Requires Steam Web API key

- 🔍 SteamDB Integration
  - Detailed build information
  - Version history tracking
  - Update changelogs
  - Optional and can be enabled separately

## 📋 Prerequisites

- **Docker & Docker Compose** (recommended for production)
- **Node.js v20+** (for development)
- **MongoDB** (cloud service like MongoDB.com/Atlas or local container)

## 🛠️ Installation & Deployment

### Method 1: Automated Production Deployment (Recommended)

1. **Clone the repository:**
```bash
git clone https://github.com/darkmaster420/AIOgames.git
cd AIOgames
```

2. **Configure environment variables:**
Create `.env` file in the project root:
```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/aiogames  # or your MongoDB.com URI

# Security
JWT_SECRET=your-super-secure-jwt-secret-key

# Downloader Services
ARIA2_SECRET=your-aria2-rpc-secret
QB_USERNAME=admin
QB_PASSWORD=your-qbittorrent-password
JD_EMAIL=your-myjdownloader-email
JD_PASSWORD=your-myjdownloader-password

# Optional: Steam Integration
STEAM_API_KEY=your-steam-web-api-key
```

3. **Deploy with automated script:**
```bash
chmod +x ./deploy.sh
./deploy.sh
```

The script will:
- ✅ Detect your MongoDB configuration (cloud vs container)
- ✅ Select appropriate Docker Compose configuration
- ✅ Build and start all services
- ✅ Set up networking and volumes
- ✅ Initialize default admin user

### Method 2: Manual Production Deployment

**For External MongoDB (MongoDB.com, Atlas, etc.):**
```bash
# Build and start with production configuration
docker compose -f docker-compose.prod.yml up --build -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Stop services
docker compose -f docker-compose.prod.yml down
```

**For Local MongoDB Container:**
```bash
# Build and start with local MongoDB
docker compose up --build -d

# View logs  
docker compose logs -f

# Stop services
docker compose down
```

### Method 3: Development Setup

1. **Install dependencies:**
```bash
# Backend dependencies
cd backend && npm install

# Frontend dependencies  
cd ../frontend && npm install
```

2. **Start development servers:**
```bash
# Terminal 1: Start backend
cd backend && npm run dev

# Terminal 2: Start frontend
cd frontend && npm run dev

# Terminal 3: Start required services (aria2, qbittorrent, etc.)
docker compose up aria2 qbittorrent -d
```

## 🔧 Service Management

### Production Container Management
```bash
# View running services
docker compose -f docker-compose.prod.yml ps

# View service logs
docker compose -f docker-compose.prod.yml logs [service-name]

# Restart specific service
docker compose -f docker-compose.prod.yml restart [service-name]

# Update and rebuild
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up --build -d

# Clean rebuild (removes images)
docker compose -f docker-compose.prod.yml down --rmi all
docker compose -f docker-compose.prod.yml up --build -d
```

### Service Health Checks
```bash
# Check application health
curl http://localhost:3000/health

# Check individual services
curl http://localhost:6801  # Aria2 RPC
curl http://localhost:8081  # qBittorrent Web UI
curl http://localhost:3129  # JDownloader API
```
npm start
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Detailed Configuration

### Environment Variables

#### Core Settings
```env
NODE_ENV=development        # Application environment
PORT=3000                  # Backend server port
JWT_SECRET=your-secret-key # JWT authentication secret
MONGODB_URI=mongodb://localhost:27017/aiogames  # MongoDB connection string
```

#### Download Services

##### aria2 Configuration
```env
ARIA2_HOST=localhost       # aria2 RPC host
ARIA2_PORT=6800           # aria2 RPC port
ARIA2_SECRET=your-secret  # aria2 RPC secret
```

##### JDownloader Configuration
```env
JD_EMAIL=your-email       # MyJDownloader email
JD_PASSWORD=your-password # MyJDownloader password
JD_DEVICE_ID=device-id   # JDownloader device ID
```

##### qBittorrent Configuration
```env
QB_URL=http://localhost:8080  # qBittorrent WebUI URL
QB_USERNAME=admin            # qBittorrent username
QB_PASSWORD=adminadmin      # qBittorrent password
```

#### Game API Configuration
```env
GAME_API_URL=https://your-worker-subdomain.workers.dev  # Game API URL
GAME_API_CACHE_TIMEOUT=3600000  # Cache timeout in milliseconds
```

#### Optional: Steam Integration
```env
STEAM_API_KEY=            # Steam Web API key (optional)
STEAM_UPDATE_INTERVAL=3600000  # Update check interval
STEAMDB_ENABLED=false     # Enable SteamDB integration
```

### Download Service Configuration

### aria2

1. Install aria2:
```bash
sudo apt-get install aria2
```

2. Create aria2 configuration file:
```bash
mkdir -p ~/.aria2
touch ~/.aria2/aria2.conf
```

## ⚙️ Configuration

### Environment Variables Reference

Create a `.env` file in the project root with the following variables:

#### **Core Application Settings**
```env
# Application Environment
NODE_ENV=production              # Set to 'production' for deployment
DOCKER_ENV=true                 # Enable container networking mode
PORT=3000                       # Application port (auto-detected in production)

# Security
JWT_SECRET=your-super-secure-jwt-secret-key-here

# Database
MONGODB_URI=mongodb://localhost:27017/aiogames
# For MongoDB.com/Atlas: mongodb+srv://user:pass@cluster.mongodb.net/aiogames
```

#### **Download Service Configuration**
```env
# Aria2 (HTTP/HTTPS/FTP Downloads)
ARIA2_URL=http://localhost:6800/jsonrpc    # Auto-configured for containers
ARIA2_SECRET=your-strong-aria2-secret

# qBittorrent (Torrent Downloads)
QBITTORRENT_URL=http://localhost:8080      # Auto-configured for containers  
QB_USERNAME=admin
QB_PASSWORD=your-secure-qbittorrent-password

# JDownloader (Premium Hoster Support)
JD_API_URL=http://localhost:3128/jd        # Auto-configured for containers
JD_EMAIL=your-myjdownloader-email
JD_PASSWORD=your-myjdownloader-password
JD_DEVICE_ID=your-jdownloader-device-id
```

#### **Optional: Steam Integration**
```env
# Steam Web API (for game metadata and updates)
STEAM_API_KEY=your-steam-web-api-key       # Get from https://steamcommunity.com/dev/apikey
```

### MongoDB Configuration Options

#### **Option 1: MongoDB.com / Atlas (Recommended for Production)**
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/aiogames?retryWrites=true&w=majority
```

#### **Option 2: Local MongoDB Container (Development)**
```env  
MONGODB_URI=mongodb://localhost:27017/aiogames
```

#### **Option 3: Self-Hosted MongoDB**
```env
MONGODB_URI=mongodb://your-mongo-host:27017/aiogames
```

### Service URLs (Auto-Configured)

The application automatically configures service URLs based on environment:

| Environment | Aria2 | qBittorrent | JDownloader |
|-------------|-------|-------------|-------------|
| **Development** | `http://localhost:6800` | `http://localhost:8080` | `http://localhost:3128` |
| **Production/Docker** | `http://localhost:6800` (internal) | `http://localhost:8080` (internal) | `http://localhost:3128` (internal) |
| **External Access** | `http://localhost:6801` | `http://localhost:8081` | `http://localhost:3129` |

### Port Configuration

| Service | Internal Port | External Port | Description |
|---------|---------------|---------------|-------------|
| **AIOgames Web** | 3000 | 3000 | Main application interface |
| **Aria2 RPC** | 6800 | 6801 | Aria2 JSON-RPC interface |
| **qBittorrent Web** | 8080 | 8081 | qBittorrent web interface |
| **JDownloader API** | 3128 | 3129 | JDownloader API endpoint |

### Volume Mounts (Production)

```yaml
volumes:
  - aiogames_data:/app/data          # Application data
  - downloads_data:/app/downloads    # Downloaded files
  - config_data:/app/config         # Service configurations  
  - logs_data:/app/logs             # Application logs
```

## 📖 Detailed Usage Guide

### First Time Setup

1. **Access the application**: http://localhost:3000
2. **Login with default credentials**: 
   - Username: `admin`
   - Password: `admin`
3. **Change default password** in the settings
4. **Configure download services** if needed

### Game Management
1. Access the application through your web browser
2. Create an account or log in with existing credentials
3. JWT tokens are used for secure session management

### Dashboard Navigation
1. **Recent Updates**: View the latest game releases
2. **Search**: 
   - Use the search bar to find specific games
   - Filter by site (Skidrow, FreeGOG, GameDrive, SteamRip)
   - View detailed game information and screenshots

### Game Downloads
1. **Selecting Downloads**:
   - Browse available download sources
   - View supported download services for each link
   - Choose preferred download method

2. **Download Types**:
   - Direct Downloads: Handled by aria2
   - Premium Hosts: Processed through JDownloader
   - Torrents: Managed by qBittorrent
   - Encrypted Links: Automatically decrypted before processing

3. **Download Management**:
   - Monitor download progress in real-time
   - View download speeds and ETAs
   - Pause, resume, or cancel downloads
   - Handle multiple downloads simultaneously

### Steam Integration (Optional)
1. **Game Updates**:
   - Automatic version checking
   - Build number tracking
   - Update notifications
   - Game metadata enrichment

2. **SteamDB Features** (if enabled):
   - Detailed build information
   - Version history
   - Changelogs
   - Release tracking

## Security Considerations

### Authentication & Authorization
- JWT-based authentication for all routes
- Token expiration and refresh mechanism
- Role-based access control
- Secure password hashing using bcrypt
- Protection against brute force attacks

### API Security
- Rate limiting for API endpoints
- CORS configuration for API access
- Input validation and sanitization
- Protection against common web vulnerabilities

### Data Security
- Environment variables for sensitive configuration
- Secure storage of API keys and credentials
- Database encryption options
- Regular security updates

### Network Security
- HTTPS required for production deployment
- Secure WebSocket connections
- Download service connection security
- Proxy configuration for external services

### Best Practices
- Regular security audits
- Dependency vulnerability scanning
- Secure coding guidelines
- Error handling and logging

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT License - see the [LICENSE](LICENSE) file for details

## Docker Deployment

### Pre-Deployment Checklist

1. **Environment Setup**
   Copy `.env.example` to `.env` in the root folder and configure your settings:
   ```bash
   # Core Configuration
   NODE_ENV=production
   PORT=2000
   JWT_SECRET=generate-a-secure-random-string

   # Database Configuration
   MONGODB_URI=mongodb://mongodb:27017/aiogames

   # Game API Configuration
   GAME_API_URL=https://your-worker-subdomain.workers.dev
   GAME_API_CACHE_TIMEOUT=3600000  # 1 hour in milliseconds

   # Download Services
   ARIA2_HOST=localhost
   ARIA2_PORT=6800
   ARIA2_SECRET=generate-a-secure-secret

   QB_USERNAME=admin
   QB_PASSWORD=generate-a-strong-password

   JD_EMAIL=your-jd-account@email.com
   JD_PASSWORD=your-jd-password
   JD_DEVICE_ID=your-device-id  # Optional, will be auto-generated if not set

   # Optional: Steam Integration
   STEAM_API_KEY=your-steam-api-key
   ```

2. **Directory Structure**
   Create required directories:
   ```bash
   mkdir -p data downloads config logs
   chmod 777 data downloads config logs  # Ensure container can write
   ```

### Deployment Commands

1. **First-time Setup**
   ```bash
   # Clone repository
   git clone https://github.com/darkmaster420/AIOgames.git
   cd AIOgames
   
   # Create .env file (see above)
   cp .env.example .env
   nano .env  # Edit with your settings
   
   # Start services
   docker-compose up -d
   
   # Check status
   docker-compose ps
   docker-compose logs -f
   ```

2. **Post-Deployment Verification**
   ```bash
   # Check container health
   curl http://localhost:2000/health
   
   # Check logs for service status
   docker-compose logs -f aiogames
   ```

3. **Common Operations**
   ```bash
   # Stop services
   docker-compose down
   
   # View logs
   docker-compose logs -f aiogames    # Main container
   docker-compose logs -f mongodb     # Database
   
   # Restart service
   docker-compose restart aiogames
   
   # Rebuild after changes
   docker-compose build --no-cache
   docker-compose up -d
   ```

4. **Configuration Files Location**
   - Main app config: `./config/`
   - Downloads: `./downloads/`
   - MongoDB data: `./data/`
   - Logs: `./logs/`

### Quick Start

1. Clone the repository:
```bash
git clone https://github.com/darkmaster420/AIOgames.git
cd AIOgames
```

2. Create a `.env` file with your configuration:
```bash
# App Configuration
PORT=2000
JWT_SECRET=your-secret-key

# Download Services
ARIA2_SECRET=your-aria2-secret
QB_USERNAME=admin
QB_PASSWORD=your-qbittorrent-password
JD_EMAIL=your-jdownloader-email
JD_PASSWORD=your-jdownloader-password

# Optional: Steam Integration
STEAM_API_KEY=your-steam-api-key
```

3. Start the containers:
```bash
docker-compose up -d
```

### Container Architecture

The application runs in a multi-container environment:

1. **Main Container (`aiogames`)**
   - Frontend (React)
   - Backend (Node.js)
   - aria2
   - qBittorrent
   - JDownloader
   - Process management via supervisord

2. **Database Container (`mongodb`)**
   - MongoDB instance
   - Persistent data storage

### Volume Management

The following volumes are used:
- `/app/data`: Application data
- `/app/downloads`: Download directory
- `/app/config`: Configuration files
- `/app/logs`: Log files
- `mongodb_data`: MongoDB data

### Port Configuration

- Exposed Port: 2000 (Frontend/Backend API)
- Internal Services (not exposed):
  - aria2 RPC: localhost:6800
  - qBittorrent WebUI: localhost:8080
  - JDownloader API: localhost:3000
  - MongoDB: mongodb:27017

All download services run in the same container and are accessed internally by the backend using localhost/127.0.0.1, improving security by minimizing exposed ports.

### Production Deployment

1. **Security Considerations**
   - Change all default passwords
   - Use strong secrets
   - Consider using a reverse proxy
   - Limit exposed ports
   - Use Docker secrets for sensitive data

2. **Performance Tuning**
   - Adjust MongoDB cache size
   - Configure download service limits
   - Set appropriate CPU/memory limits
   - Monitor container resources

3. **Backup Strategy**
   - Regular MongoDB backups
   - Config file backups
   - Download directory management

### Health Monitoring

The container includes health checks for:
- Backend API
- MongoDB connection
- Download services

Access health status:
```bash
docker ps  # Check container health
docker logs aiogames  # View application logs
```

### Updating

1. Pull latest changes:
```bash
git pull
```

2. Rebuild and restart:
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Troubleshooting

1. **Container fails to start**
   - Check logs: `docker-compose logs`
   - Verify environment variables
   - Check port conflicts
   - Ensure sufficient permissions

2. **Download services issues**
   - Check service-specific logs
   - Verify network connectivity
   - Validate service credentials

3. **Database connection issues**
   - Check MongoDB container status
   - Verify connection string
   - Check volume permissions

## API Integration

### Game Search API

The application integrates with a Cloudflare Worker-based game search API that provides:

#### Endpoints
- `/?search=<query>&site=<site>`: Search for games
- `/recent`: Get recent game uploads
- `/decrypt?hash=<hash>`: Decrypt encrypted download links
- `/proxy-image?url=<url>`: Proxy game images

#### Response Format
```json
{
  "success": true,
  "results": [
    {
      "id": "unique-id",
      "title": "Game Title",
      "description": "Game description",
      "date": "2025-09-01T12:00:00Z",
      "image": "https://example.com/image.jpg",
      "link": "https://source-site.com/game/123",
      "source": "SourceSite",
      "downloadLinks": [
        {
          "type": "hosting",
          "service": "ServiceName",
          "url": "https://download-url.com/file",
          "text": "Download Link"
        }
      ]
    }
  ],
  "siteStats": {
    "SourceSite": 10
  }
}
```

#### Features
- Multi-source game search
- Download link processing
- Crypt link decryption
- Image proxying
- Caching system
- Error handling

### Integration Configuration
1. Set up the Game API URL in environment variables
2. Configure cache timeout settings
3. Add any required API authentication
4. Set up error handling and monitoring

## 🔧 Troubleshooting

### Production Deployment Issues

#### **Container Won't Start**
```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# View detailed logs
docker compose -f docker-compose.prod.yml logs

# Check resource usage
docker stats aiogames-app
```

#### **Port Conflicts**
```bash
# Check what's using the ports
netstat -tlnp | grep -E '(3000|6801|8081|3129)'

# Kill conflicting processes
sudo pkill -f aria2c
sudo pkill -f qbittorrent

# Or use different ports in docker-compose.prod.yml
```

#### **Permission Issues**
```bash
# Fix volume permissions
docker compose -f docker-compose.prod.yml down
docker volume rm aiogames_logs_data aiogames_config_data
docker compose -f docker-compose.prod.yml up --build -d
```

### Download Service Issues

#### **Aria2 Connection Failed**
```bash
# Check Aria2 is running
docker exec aiogames-app ps aux | grep aria2

# Test Aria2 RPC
curl -X POST http://localhost:6801/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"test","method":"aria2.getVersion","params":["token:your-secret"]}'

# Check logs
docker exec aiogames-app tail -f /app/logs/backend.log | grep -i aria2
```

#### **qBittorrent WebUI Not Accessible**
```bash
# Access qBittorrent directly
curl -I http://localhost:8081

# Check qBittorrent process
docker exec aiogames-app ps aux | grep qbittorrent

# Reset qBittorrent config
docker exec aiogames-app rm -rf /config/qbittorrent/config
docker compose -f docker-compose.prod.yml restart
```

#### **JDownloader Not Connecting**
```bash
# Check JDownloader process
docker exec aiogames-app ps aux | grep java

# View JDownloader logs
docker exec aiogames-app tail -f /app/logs/jdownloader.log

# Verify MyJDownloader credentials
# Login to https://my.jdownloader.org/ and check device status
```

### Database Connection Issues

#### **MongoDB Connection Failed**
```bash
# Test MongoDB connection
docker exec aiogames-app node -e "
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ MongoDB Error:', err.message));
"

# For MongoDB.com/Atlas issues:
# 1. Check IP whitelist (add 0.0.0.0/0 for testing)
# 2. Verify username/password
# 3. Check network access in MongoDB Atlas
```

### Application Issues

#### **Web Interface Won't Load**
```bash
# Check if backend is running
curl http://localhost:3000/health

# Check backend logs
docker exec aiogames-app tail -f /app/logs/backend.log

# Verify static files are served
docker exec aiogames-app ls -la /app/public/

# Test API endpoints
curl http://localhost:3000/api/games
```

#### **Login Issues**
```bash
# Reset admin password
docker exec aiogames-app node -e "
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const { User } = await import('./src/models/user.js');
  const hashedPassword = await bcrypt.hash('admin', 10);
  await User.findOneAndUpdate({username: 'admin'}, {password: hashedPassword});
  console.log('✅ Admin password reset to: admin');
  process.exit(0);
});
"
```

### Performance Issues

#### **Slow Download Speeds**
```bash
# Check aria2 configuration
docker exec aiogames-app cat /config/aria2/aria2.conf

# Monitor download progress
docker exec aiogames-app aria2-rpc getGlobalStat

# Check system resources
docker stats aiogames-app
```

#### **High CPU/Memory Usage**
```bash
# Monitor container resources
docker stats

# Check service processes
docker exec aiogames-app top

# Restart specific services
docker exec aiogames-app supervisorctl restart aria2
docker exec aiogames-app supervisorctl restart qbittorrent
```

### Logs and Debugging

#### **Access Application Logs**
```bash
# View all logs
docker compose -f docker-compose.prod.yml logs -f

# View specific service logs
docker exec aiogames-app tail -f /app/logs/backend.log
docker exec aiogames-app tail -f /app/logs/aria2.log
docker exec aiogames-app tail -f /app/logs/qbittorrent.log
docker exec aiogames-app tail -f /app/logs/jdownloader.log

# View supervisor logs
docker exec aiogames-app supervisorctl status
```

#### **Enable Debug Mode**
```bash
# Add to .env file
DEBUG=true
NODE_ENV=development

# Rebuild and restart
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up --build -d
```

### Getting Help

If you encounter issues not covered here:

1. **Check GitHub Issues**: [AIOgames Issues](https://github.com/darkmaster420/AIOgames/issues)
2. **Enable debug logging** and share relevant log output
3. **Include system information**:
   - Docker version: `docker --version`
   - Docker Compose version: `docker compose version`
   - Operating system and version
   - Available system resources

## 🆕 Latest Features (v2.0)

### 🚀 Production-Ready Deployment
- **Automated deployment script** (`deploy.sh`) with MongoDB detection
- **Multi-stage Docker builds** with optimized production images  
- **Container networking** with reliable service communication
- **Volume persistence** for data, downloads, configs, and logs
- **Health checks** and proper service supervision

### 📱 Mobile-First Interface
- **Responsive design** that works on phones, tablets, and desktops
- **Mobile navigation** with hamburger menu
- **Touch-friendly controls** and optimized button layouts
- **Dark mode support** with system preference detection
- **Mobile-optimized notifications** and progress indicators

### 🔧 Enhanced Service Integration  
- **Smart URL detection** for development vs production environments
- **Improved connection reliability** with extended timeouts and retry logic
- **Container-aware networking** for Docker deployments
- **Better error handling** with detailed connection status and cooldown timers
- **Service health monitoring** with automatic restart capabilities

### 📊 Advanced Game Management
- **Game tracking system** with automatic update detection
- **Multi-source search** across SkidrowReloaded, FreeGOGPCGames, GameDrive, SteamRip
- **Version monitoring** with changelog tracking
- **Storage management** with disk usage monitoring
- **Real-time updates** via WebSocket connections

## 🤝 Support & Contributing

### Getting Help

1. **Documentation**: Check this README and inline code comments
2. **GitHub Issues**: [Report bugs or request features](https://github.com/darkmaster420/AIOgames/issues)
3. **Troubleshooting**: Follow the comprehensive troubleshooting guide above
4. **Logs**: Enable debug mode for detailed error information

### Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository** on GitHub
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** following the coding standards
4. **Test thoroughly** in both development and production environments
5. **Submit a pull request** with a clear description of changes

### Development Setup for Contributors

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/AIOgames.git
cd AIOgames

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start development environment
docker compose up -d aria2 qbittorrent  # Start services
cd backend && npm run dev                # Start backend
cd frontend && npm run dev               # Start frontend
```

### Project Structure
```
AIOgames/
├── backend/                 # Node.js Express API
│   ├── src/
│   │   ├── api/            # API routes
│   │   ├── models/         # Database models  
│   │   ├── services/       # Download services
│   │   └── middleware/     # Authentication & validation
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── contexts/       # React contexts
│   │   └── styles/         # Tailwind CSS
├── scripts/                # Production configuration
│   ├── aria2.conf         # Aria2 configuration
│   ├── supervisord.conf   # Service supervision
│   └── entrypoint.sh      # Container startup
├── deploy.sh              # Automated deployment
├── Dockerfile.prod        # Production Docker image
├── docker-compose.prod.yml # Production compose
└── docker-compose.yml     # Development compose
```

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **aria2** - High-speed download utility
- **qBittorrent** - Feature-rich torrent client  
- **JDownloader** - Premium hoster support
- **React** - Frontend framework
- **Express.js** - Backend framework
- **MongoDB** - Database solution
- **Docker** - Containerization platform

---

**Made with ❤️ for the gaming community**

*AIOgames v2.0 - Production-Ready Game Download Manager*