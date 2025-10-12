# 🎮 AIO-Games - Automated Game Update Tracker

A powerful Next.js application that automatically tracks game updates across multiple piracy sites with zero configuration required.

## ✨ Key Features

- 🔍 **Multi-Site Tracking**: Monitors GameDrive, SteamRip, SkidRow, FreeGog and more
- 🤖 **Automatic Scheduling**: Built-in update checker - no cron jobs needed
- 🏴‍☠️ **Smart Piracy Tag Handling**: Handles 50+ scene groups and release formats
- ⚡ **Lightning Fast**: Sub-second update checks
- 🎯 **Intelligent Matching**: Version-aware updates with confidence scoring
- 📱 **Real-time Notifications**: Telegram and web push notifications
- 🔐 **Secure Authentication**: NextAuth.js with multiple providers
- 🌙 **Dark Mode**: Beautiful UI with light/dark theme support
- 🐳 **Container Ready**: Docker deployment with zero external dependencies

## 🚀 Quick Start

### Docker Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/yourusername/AIOgames.git
cd AIOgames

# Copy environment file and configure
cp .env.example .env
# Edit .env with your settings

# Start with Docker Compose
docker compose -f docker-compose.production.yml up -d
```

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local
# Configure your environment variables

# Start development server
npm run dev
```

## ⚙️ Environment Configuration

Required environment variables:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/aiogames

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key

# APIs
GAME_API_URL=https://gameapi.a7a8524.workers.dev

# Telegram Bot (Optional)
TELEGRAM_WEBHOOK_TOKEN=your-webhook-verification-token

# Notifications (Optional)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-key
VAPID_PRIVATE_KEY=your-vapid-private-key
```

## 🤖 Telegram Bot Integration (not currently working)

AIOgames features a powerful Telegram bot system that allows users to manage their game tracking directly from Telegram.

### Setup Instructions

1. **Create a Bot**:
   - Message [@BotFather](https://t.me/BotFather) on Telegram
   - Use `/newbot` to create a new bot
   - Save the bot token

2. **Get Your Chat ID**:
   - Message [@userinfobot](https://t.me/userinfobot) 
   - Copy your chat ID

3. **Configure in App**:
   - Go to User Settings → Telegram Bot Management
   - Enter your bot token and chat ID
   - Click "Setup Bot"

4. **Start Using**:
   - Message your bot with `/start`
   - Use commands like `/help`, `/update`, `/track`, etc.

### Available Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and setup confirmation |
| `/help` | Show all available commands |
| `/update` | Check all tracked games for updates |
| `/track <game title>` | Add a game to your tracking list |
| `/untrack <game title>` | Remove a game from tracking |
| `/search <query>` | Search for games to track |
| `/list` | Show all your tracked games |
| `/settings` | Get link to manage your settings |

### Bot Features

- **🎮 Game Sharing**: Send games from the web interface directly to Telegram
- **📱 Mobile Management**: Full game tracking control from your phone
- **🔄 Update Notifications**: Get instant updates when games are updated
- **🔍 Smart Search**: Search and track games without opening the website
- **📊 Status Overview**: View your tracking status and recent updates

### Technical Details

The Telegram integration uses:
- **User-owned bots**: Each user configures their own bot (more reliable than shared bots)
- **Webhook system**: Real-time command processing
- **Secure authentication**: Commands are validated against registered users
- **Rich messaging**: Formatted messages with game details and links

## 📖 How It Works

1. **Sign up** with email
2. **Search games** using the integrated game finder
3. **Track games** with customizable update frequencies
4. **Automatic updates** run in background (hourly/daily/weekly)
5. **Get notified** when updates are found via Telegram or push notifications

## 🔧 Production Features

### Automatic Update Scheduling
- ✅ **Zero Configuration**: Internal scheduler handles everything
- ✅ **Per-Game Frequency**: Choose hourly, daily, weekly, or manual checking
- ✅ **Smart Resource Usage**: Only checks when updates are due
- ✅ **Real-time Status**: Monitor automatic update schedule from dashboard

### Advanced Game Matching
- ✅ **Scene Group Detection**: Recognizes CODEX, EMPRESS, FitGirl, DODI, etc.
- ✅ **Version Intelligence**: Semantic version comparison with build numbers
- ✅ **Steam Integration**: Enhanced matching using Steam API
- ✅ **Cross-Site Coverage**: Updates tracked across all supported sites

### Robust Notifications
- ✅ **Telegram Integration**: Rich messages with download links
- ✅ **Web Push Notifications**: Browser notifications with service worker
- ✅ **Update History**: Complete tracking of all game updates
- ✅ **Sequel Detection**: Automatically detect game sequels and expansions

## 📊 API Endpoints

### Game Tracking
- `GET /api/tracking` - Get tracked games
- `POST /api/tracking` - Add game to tracking
- `DELETE /api/tracking` - Remove tracked game

### Update Management
- `POST /api/updates/check` - Manual update check
- `POST /api/updates/check-single` - Check specific game
- `GET /api/scheduler` - View automatic update status

### Authentication
- `POST /api/auth/register` - User registration
- Standard NextAuth.js endpoints for authentication

## 🐳 Docker Deployment

### Production Setup

```bash
# Production deployment
docker compose -f docker-compose.production.yml up -d

# View logs
docker compose -f docker-compose.production.yml logs -f

# Stop services
docker compose -f docker-compose.production.yml down
```

### Development Setup

```bash
# Development with hot reload
docker compose -f docker-compose.development.yml up -d
```

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, MongoDB with Mongoose
- **Authentication**: NextAuth.js with GitHub/Email providers
- **Notifications**: Telegram Bot API, Web Push API
- **Containerization**: Docker with multi-stage builds
- **External APIs**: Custom Cloudflare Workers for game data

## 📱 Browser Support

- ✅ Chrome/Edge 88+
- ✅ Firefox 78+  
- ✅ Safari 14+
- ✅ Mobile browsers with service worker support

## 🔒 Security

- Server-side authentication with NextAuth.js
- Environment variable protection
- CORS configuration for external API access
- Secure cookie handling
- XSS protection with proper content security policies

## 📈 Performance

- Sub-second update checks using optimized algorithms
- Efficient database queries with MongoDB aggregation
- Client-side caching with React hooks
- Optimized Docker images with multi-stage builds
- Background processing for automatic updates

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- Create an [Issue](https://github.com/yourusername/AIOgames/issues) for bug reports
- Check existing issues before creating new ones
- Provide detailed information for faster resolution

---

**🎯 Built with ❤️ for the gaming community**
