# AIOgames - Unified Game Manager

A modern, comprehensive web application for discovering, tracking, and managing game updates. Built with Next.js 15, TypeScript, and MongoDB with full authentication and admin capabilities.

## 🆕 Recent Major Updates (September 2025)

### ✨ Auto Steam Verification System
- **Automatic Steam verification** for all newly added games
- **Confidence-based matching** with 85%/80% thresholds
- **Dual-attempt verification** using original and cleaned game titles
- **Enhanced compatibility** supporting both "game" and "app" Steam API responses

### 🗑️ Improved Game Management
- **Proper game deletion** - games are now completely removed from tracking
- **Fixed duplicate tracking issues** - no more "already tracked" errors
- **Seamless re-addition** of previously tracked games

### 👑 Enhanced Admin Dashboard
- **Complete game oversight** - view and manage all tracked games across users
- **Advanced filtering** by title, source, and Steam verification status
- **Pagination support** for handling large datasets efficiently
- **Visual verification indicators** showing Steam integration status
- **Streamlined deletion** with confirmation dialogs

---

## ✨ Features

### 🔐 Authentication & User Management
- Secure user registration and login with bcrypt password hashing
- Session-based authentication with NextAuth.js
- User-specific game tracking and preferences
- Role-based access control (user/admin)
- Protected routes and API endpoints

### 🎮 Game Discovery & Management
- Search and browse games from multiple sources
- Rich game information with images and descriptions
- Universal download link access for all games
- Custom game tracking by name input
- Direct links to download posts
- **🆕 Automatic Steam verification** for newly added games with confidence-based matching
- **🆕 Proper game deletion** - no more "already tracked" errors when re-adding games

### 📊 Advanced Game Tracking
- Track your favorite games for updates
- **🆕 Auto Steam verification** with 85%/80% confidence thresholds for all new additions
- Intelligent ambiguous update detection with multiple matching strategies
- Automatic update detection and notifications
- Update history and version tracking
- Sequel/prequel detection and notifications
- Dedicated tracking dashboard

### 👑 Admin Dashboard
- Comprehensive admin panel with user management
- **🆕 Complete game management system** with advanced filtering and pagination
- **🆕 Steam verification status tracking** across all users
- **🆕 Game deletion capabilities** with confirmation dialogs
- System statistics and monitoring
- User oversight with deletion capabilities
- Game tracking analytics
- Admin-only routes and features

### 🌙 Modern UI/UX
- Responsive navigation with role-based menu items
- Dark/Light mode support with theme persistence
- Mobile-first responsive design for all devices
- Clean, intuitive interface with consistent navigation
- Real-time updates and loading states

### 🔄 Intelligent Update Management
- Manual and automatic update checks
- Configurable check frequencies
- Smart ambiguous update detection for games with unclear versioning
- Notification system (console logs, extensible for email/Discord)
- Update statistics and history tracking

## 🛠 Tech Stack

- **Frontend**: Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, MongoDB with Mongoose ODM
- **Authentication**: NextAuth.js with JWT and credentials provider
- **External APIs**: Custom Cloudflare Workers for game data aggregation
- **Deployment**: Docker support with production-ready configuration
- **Development**: ESLint, TypeScript strict mode, mobile-responsive design

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- MongoDB Atlas account (recommended) or local MongoDB
- Docker (optional)

### Setup MongoDB Atlas (Recommended)

1. **Create a MongoDB Atlas account:**
   - Go to [mongodb.com](https://www.mongodb.com/cloud/atlas)
   - Create a free cluster
   - Create a database user
   - Whitelist your IP address (or use 0.0.0.0/0 for development)

2. **Get your connection string:**
   - In Atlas, click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user's password
   - Replace `<database>` with your preferred database name (e.g., "aiogames")

## 🚀 Quick Start

### Option 1: Docker (Recommended)

The fastest way to get started is using our pre-built Docker image:

```bash
# Quick deploy with everything included
curl -sSL https://raw.githubusercontent.com/darkmaster420/AIOgames/main/scripts/quick-deploy.sh | bash
```

**Or manually with Docker Compose:**
```bash
# Download configuration
curl -o docker-compose.yml https://raw.githubusercontent.com/darkmaster420/AIOgames/main/docker-compose.prod.yml
curl -o .env.example https://raw.githubusercontent.com/darkmaster420/AIOgames/main/.env.example

# Configure environment
cp .env.example .env
nano .env  # Edit with your settings

# Start services
docker-compose up -d
```

**Docker Images Available:**
- `ghcr.io/darkmaster420/aiogames:latest` - Latest stable release
- `ghcr.io/darkmaster420/aiogames:v1.0.0` - Specific version tags
- Multi-architecture support: `linux/amd64`, `linux/arm64`

📚 **[Complete Docker Deployment Guide](docs/DOCKER_REGISTRY_DEPLOYMENT.md)**

### Option 2: Build from Source

1. **Clone and install dependencies:**
```bash
git clone <repository>
cd AIOgames
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Database - Use your MongoDB Atlas connection string
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/aiogames?retryWrites=true&w=majority

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secure-nextauth-secret-key

# Game API
GAME_API_URL=https://gameapi.a7a8524.workers.dev
```

3. **Run the development server:**
```bash
npm run dev
```

Visit http://localhost:3000 to see the application.

> **📚 First Time Setup**: See [AUTHENTICATION.md](docs/AUTHENTICATION.md) for detailed MongoDB Atlas setup instructions.

### Docker Setup (Alternative)

```bash
# Build and run with Docker Compose
docker-compose up -d

# For production
docker-compose -f docker-compose.prod.yml up -d
```

## Usage

### Basic Workflow

1. **Create Account**: Register at `/auth/signup` or sign in at `/auth/signin`
2. **Discover Games**: Use the search function to find games
3. **Track Games**: Click "Track Game" on games you want to monitor
4. **Monitor Updates**: Visit the Tracking Dashboard to see tracked games
5. **Check Updates**: Use manual "Check for Updates" or set up automatic checks
6. **Sign Out**: Use the "Sign Out" button when finished

### Setting up Automatic Updates

The system can automatically check for updates using cron jobs:

```bash
# Edit crontab
crontab -e

# Add line to check every 6 hours:
0 */6 * * * /path/to/AIOgames/scripts/check-updates.sh >> /var/log/aiogames-updates.log 2>&1
```

See [GAME_TRACKING.md](docs/GAME_TRACKING.md) for detailed setup instructions.

## API Endpoints

### Games
- `GET /api/games/recent` - Get recent games
- `GET /api/games/search?search=query` - Search games

### Tracking
- `GET /api/tracking` - Get tracked games
- `POST /api/tracking` - Add game to tracking
- `DELETE /api/tracking?gameId=id` - Remove from tracking

### Updates
- `POST /api/updates/check` - Manual update check
- `GET /api/updates/check` - Get update status

### Notifications
- `POST /api/notifications` - Send notification
- `GET /api/notifications` - Get notification history

## Project Structure

```
src/
├── app/
│   ├── api/           # API routes
│   ├── tracking/      # Tracking dashboard page
│   └── page.tsx       # Main page
├── components/        # React components
├── lib/
│   ├── db.ts         # Database connection
│   └── models.ts     # MongoDB models
└── styles/           # Global styles

scripts/
├── check-updates.sh  # Update checker script
└── ...

docs/
├── GAME_TRACKING.md  # Detailed tracking setup
├── DOCKER_REGISTRY_DEPLOYMENT.md  # Docker deployment guide
└── ...
```

## 🚢 Deployment Options

### Production Deployment

**🐳 Docker (Recommended)**
- Pre-built images on GitHub Container Registry
- Automated builds with security scanning
- Multi-architecture support (AMD64/ARM64)
- One-command deployment

**📋 Manual Setup**
- Build from source on your server
- Full control over environment
- Custom configurations

**☁️ Cloud Platforms**
- Deploy Docker images to any cloud provider
- Container orchestration support
- Scalable infrastructure

See [DOCKER_REGISTRY_DEPLOYMENT.md](docs/DOCKER_REGISTRY_DEPLOYMENT.md) for complete deployment instructions.

## Development

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript checks
```

### Database Schema

**TrackedGame Model:**
- `gameId`: Unique game identifier
- `title`: Game title
- `source`: Source platform
- `updateHistory`: Array of found updates
- `lastChecked`: Last update check timestamp
- `notificationsEnabled`: Whether to send notifications

See [GAME_TRACKING.md](docs/GAME_TRACKING.md) for complete schema details.

## Configuration

### Environment Variables

```env
# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/aiogames

# Authentication
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=your-production-secret-key

# Admin User Setup (Auto-created on first startup)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=your-secure-admin-password
ADMIN_NAME=Site Administrator

# Optional
NODE_ENV=production
```

### Admin User Setup

The admin user is automatically created when the application starts for the first time. Simply configure the admin environment variables:

1. **Set admin credentials in `.env`:**
   ```env
   ADMIN_EMAIL=admin@yourdomain.com
   ADMIN_PASSWORD=your-secure-admin-password
   ADMIN_NAME=Site Administrator
   ```

2. **Start the application** - The admin user will be created automatically

3. **Access admin dashboard:**
   - Login at `/auth/signin` with your admin credentials
   - Navigate to `/admin` for the admin dashboard

**Features available to admin users:**
- 👥 User management and oversight
- 📊 System statistics and analytics  
- 🎮 Game tracking statistics
- 🔧 System configuration
- 🗑️ User deletion capabilities

> **🔒 Security Note**: The admin seeding only works in development or when explicitly configured. Change the default admin password in production!

### Update Check Frequency

Update checks can be configured per game with these frequencies:
- `hourly` - Every hour
- `daily` - Once per day (default)
- `weekly` - Once per week
- `manual` - Only manual checks

## Deployment

### Production Build

```bash
npm run build
npm start
```

### Docker Deployment

```bash
# Build production image
docker build -f Dockerfile.prod -t aiogames:latest .

# Run with docker-compose
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Setup

For production deployment:

1. Set `NODE_ENV=production`
2. Configure secure MongoDB connection
3. Set up reverse proxy (nginx) if needed
4. Configure cron jobs for automatic updates
5. Set up monitoring and logging

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -am 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines

- Use TypeScript for type safety
- Follow ESLint configuration
- Write tests for new features
- Update documentation for API changes
- Test both light and dark modes

## Troubleshooting

### Common Issues

1. **MongoDB Connection**: Ensure MongoDB is running and connection string is correct
2. **Port Conflicts**: Default port is 3000, change in `package.json` if needed
3. **API Errors**: Check external API availability and rate limits
4. **Build Errors**: Run `npm run lint` and `npm run type-check` to identify issues

### Debugging

Enable debug mode by setting:
```env
DEBUG=*
NODE_ENV=development
```

Check logs in:
- Browser console for client-side issues
- Terminal/Docker logs for server-side issues
- MongoDB logs for database issues

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Create an issue in the repository
- Check the [GAME_TRACKING.md](docs/GAME_TRACKING.md) documentation
- Review the troubleshooting section above

## Roadmap

- [ ] Email notifications
- [ ] Discord webhook support
- [ ] RSS feed generation
- [ ] Advanced filtering options
- [ ] User authentication
- [ ] Multi-source game aggregation
- [ ] Mobile app
- [ ] Real-time WebSocket updates