# AIOgames

An all-in-one container for managing game downloads with multiple download service support. The application provides a secure dashboard that displays game updates and allows users to manage downloads through various services like aria2, JDownloader, and qBittorrent. It integrates with a game search API to provide up-to-date game information and download options.

## Overview

AIOgames is designed to be a comprehensive game management and download solution. It combines:
- A powerful game search and information system
- Multiple download service integrations
- Secure user authentication
- Real-time progress monitoring
- Optional Steam integration for game updates

The system is built to be modular, allowing you to enable or disable features based on your needs.

## Architecture

### Frontend
- React-based dashboard
- Real-time updates using Socket.IO
- Responsive design with Tailwind CSS
- Secure authentication handling
- Download progress visualization

### Backend
- Node.js Express server
- MongoDB for data persistence
- JWT-based authentication
- WebSocket support for real-time updates
- Multiple download service integrations

### Download Services
- aria2: For HTTP/HTTPS/FTP downloads
- JDownloader: For premium hosting sites
- qBittorrent: For torrent downloads
- Automatic service selection based on link type

### Game API Integration
- Search across multiple game sources
- Recent games feed
- Automatic download link processing
- Support for encrypted links
- Image proxying to avoid CORS issues

## Features

- 🔒 Secure authentication system
- 🎮 Game updates dashboard
- 📥 Multiple downloader support:
  - aria2 (HTTP/HTTPS/FTP)
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

## Prerequisites

- Node.js (v16 or higher)
- Docker and Docker Compose
- aria2 daemon
- JDownloader
- qBittorrent with WebUI enabled

## Installation

1. Clone the repository:
```bash
git clone https://github.com/darkmaster420/AIOgames.git
cd AIOgames
```

2. Install dependencies for both frontend and backend:
```bash
# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../backend
npm install
```

3. Create environment files:

`.env` for backend:
```env
JWT_SECRET=your-secret-key
PORT=3000

# aria2 Configuration
ARIA2_HOST=localhost
ARIA2_PORT=6800
ARIA2_SECRET=your-aria2-secret

# JDownloader Configuration
JD_EMAIL=your-myjdownloader-email
JD_PASSWORD=your-myjdownloader-password
JD_DEVICE_ID=your-device-id

# qBittorrent Configuration
QB_URL=http://localhost:8080
QB_USERNAME=admin
QB_PASSWORD=adminadmin
```

`.env` for frontend:
```env
REACT_APP_API_URL=http://localhost:3000
```

## Running with Docker

1. Start the containers using Docker Compose:
```bash
docker-compose up -d
```

This will start:
- Frontend application
- Backend API
- aria2 daemon
- JDownloader
- qBittorrent

## Manual Setup

1. Start the backend server:
```bash
cd backend
npm start
```

2. Start the frontend development server:
```bash
cd frontend
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

3. Add basic configuration to `~/.aria2/aria2.conf`:
```conf
enable-rpc=true
rpc-secret=your-aria2-secret
rpc-listen-port=6800
```

### JDownloader

1. Create an account at [my.jdownloader.org](https://my.jdownloader.org/)
2. Install JDownloader and connect it to your account
3. Update the `.env` file with your MyJDownloader credentials

### qBittorrent

1. Install qBittorrent:
```bash
sudo apt-get install qbittorrent-nox
```

2. Start qBittorrent and enable WebUI:
```bash
qbittorrent-nox --webui-port=8080
```

3. Access the WebUI at http://localhost:8080 (default credentials: admin/adminadmin)

## Detailed Usage Guide

### Authentication
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
   Create `.env` file with required credentials:
   ```bash
   # Required Settings
   PORT=2000                                    # App port
   JWT_SECRET=generate-a-secure-random-string   # JWT token secret
   MONGODB_URI=mongodb://mongodb:27017/aiogames # Leave as is for docker-compose
   
   # Download Service Credentials
   ARIA2_SECRET=generate-a-secure-secret        # aria2 RPC secret
   QB_USERNAME=admin                            # qBittorrent username
   QB_PASSWORD=generate-a-strong-password       # qBittorrent password
   JD_EMAIL=your-jd-account@email.com          # JDownloader email
   JD_PASSWORD=your-jd-password                # JDownloader password
   
   # Optional: Steam Integration
   STEAM_API_KEY=your-steam-api-key            # Optional for Steam features
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

## Troubleshooting

### Common Issues

1. **Download Services**
   - Check service connectivity
   - Verify credentials
   - Ensure proper port configuration
   - Check logs for errors

2. **Game API**
   - Verify API endpoint accessibility
   - Check rate limiting
   - Monitor cache performance
   - Review error responses

3. **Steam Integration**
   - Validate API key
   - Check update intervals
   - Verify game monitoring
   - Review SteamDB access

### Logging

The application uses a comprehensive logging system:
- Access logs
- Error logs
- Download service logs
- API integration logs
- Security event logs

### Monitoring

Monitor system health through:
- Download service status
- API response times
- Cache hit rates
- Error rates
- System resource usage

## Support

### Getting Help
- GitHub Issues: Open an issue for bug reports or feature requests
- Documentation: Refer to inline code documentation
- Logs: Check application logs for detailed error information
- Configuration: Verify all environment variables and settings

### Contributing
1. Fork the repository
2. Create a feature branch
3. Follow coding standards
4. Add tests where applicable
5. Submit a pull request

### Community
- GitHub Discussions: Engage with other users
- Feature Requests: Submit ideas for improvements
- Bug Reports: Help improve stability
- Documentation: Contribute to documentation