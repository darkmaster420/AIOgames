# AIOGames Desktop App - Configuration Guide

## Initial Setup

After installing the Windows app, you need to configure your environment variables.

### Quick Setup

1. **Locate the Installation Folder**
   - Right-click the AIOGames shortcut
   - Select "Open file location"
   - Navigate to the installation directory (usually `C:\Users\YourName\AppData\Local\Programs\AIOGames\`)

2. **Edit the Configuration File**
   - Find the file `.env.production` in `resources\app\.env.production`
   - Open it with Notepad or any text editor
   - Configure the following settings:

### Required Settings

#### MongoDB Connection
```env
MONGODB_URI=mongodb://localhost:27017/aiogames
```
- For local MongoDB: `mongodb://localhost:27017/aiogames`
- For MongoDB Atlas: `mongodb+srv://username:password@cluster.mongodb.net/aiogames`

#### Authentication Secret
```env
NEXTAUTH_SECRET=your-super-secret-nextauth-secret-change-this
```
- Generate a strong random string (at least 32 characters)

#### Admin Account
```env
OWNER_EMAIL=your-email@example.com
OWNER_PASSWORD=your-secure-password
OWNER_NAME=Your Name
```

### Optional Settings

#### Telegram Bot (for notifications)
```env
TELEGRAM_BOT_TOKEN=your-bot-token-here
```
- Get a bot token from [@BotFather](https://t.me/botfather) on Telegram

#### Game API Endpoint
```env
GAME_API_URL=https://gameapi.iforgor.cc
```
- Keep the default or use your own API endpoint

#### IGDB Integration
```env
IGDB_CLIENT_ID=your-twitch-client-id
IGDB_CLIENT_SECRET=your-twitch-client-secret
```
- Get credentials from [Twitch Developer Console](https://dev.twitch.tv/console)

### Apply Changes

After editing `.env.production`:
1. Save the file
2. Restart the AIOGames application
3. Your new settings will be loaded

### Configuration Location

The configuration file is located at:
```
C:\Users\YourName\AppData\Local\Programs\AIOGames\resources\app\.env.production
```

or wherever you installed the app.

## For Developers: Pre-configured Builds

If you want to distribute a pre-configured version:

1. **Edit `.env.production`** in your project before building
2. **Update the values** with your production settings
3. **Build the installer**:
   ```bash
   npm run electron:build:win
   ```
4. The `.env.production` file will be bundled into the installer
5. Users will get your pre-configured settings

### Security Note

⚠️ **Important**: If you pre-configure the build with secrets (MongoDB passwords, API keys, etc.), these will be visible to anyone who installs the app. For distributed apps:

- Use placeholder values in `.env.production`
- Instruct users to configure their own credentials after installation
- Or implement a first-run setup wizard in the app

## Troubleshooting

### Can't Find .env.production
- Reinstall the app
- The file should be in `resources\app\.env.production` inside the installation folder

### Changes Not Applied
- Make sure you saved the file
- Completely close and restart AIOGames (not just minimize)
- Check for typos in variable names

### MongoDB Connection Failed
- Verify MongoDB is running
- Check your connection string format
- For Atlas: make sure your IP is whitelisted
