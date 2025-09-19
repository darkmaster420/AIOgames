# AIOgames

An all-in-one container for managing game downloads with multiple download service support. The application provides a secure dashboard that displays game updates and allows users to manage downloads through various services like aria2, JDownloader, and qBittorrent.

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

## Configuration

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

## Usage

1. Access the application through your web browser
2. Log in using your credentials
3. Browse the game updates in the dashboard
4. Click on a game to view available download options
5. Select your preferred download service
6. Monitor download progress in the Downloads section

## Security

- All routes are protected by JWT authentication
- Password hashing using bcrypt
- HTTPS recommended for production deployment
- Environment variables for sensitive configuration

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT License - see the [LICENSE](LICENSE) file for details

## Support

For support, please open an issue in the GitHub repository.