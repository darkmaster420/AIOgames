# Game Update Tracking Setup

## Overview
The game tracking system allows users to track their favorite games and receive notifications when updates are posted. The system periodically checks the external game API for changes and updates the database accordingly.

## Features
- Track games from the main dashboard
- View tracked games in a dedicated tracking dashboard
- Manual update checks via dashboard button
- Automatic periodic update checks (requires cron setup)
- Update history tracking for each game
- **🆕 Automatic Steam verification** with confidence-based matching
- **🆕 Proper game deletion** with complete removal from tracking
- **🆕 Enhanced admin oversight** with comprehensive game management

## Steam Integration

### Auto-Verification System
When you add a game to tracking, the system automatically attempts to verify it with Steam's database:

- **Confidence-based matching**: Uses 85% and 80% confidence thresholds
- **Dual-attempt verification**: Tries both original and cleaned game titles
- **Smart title processing**: Removes common suffixes like "Repack", "CODEX", etc.
- **Enhanced compatibility**: Supports both "game" and "app" Steam API responses
- **Metadata enhancement**: Adds Steam images, descriptions, and app IDs when found

### Manual Steam Verification
Games can also be manually verified through the Steam search modal in the tracking interface.

### Benefits of Steam Verification
- **Better update detection**: Steam-verified games have more reliable update tracking
- **Enhanced metadata**: Includes official Steam images and descriptions
- **Improved notifications**: More accurate game information for notifications
- **Sequel detection**: Better matching for game series and sequels

## Automatic Update Checking

### Method 1: Cron Job (Linux/macOS)

1. Open your crontab:
```bash
crontab -e
```

2. Add one of these lines based on your preferred frequency:

```bash
# Check every 6 hours
0 */6 * * * /workspaces/AIOgames/scripts/check-updates.sh >> /var/log/aiogames-updates.log 2>&1

# Check every 12 hours
0 */12 * * * /workspaces/AIOgames/scripts/check-updates.sh >> /var/log/aiogames-updates.log 2>&1

# Check once daily at 9 AM
0 9 * * * /workspaces/AIOgames/scripts/check-updates.sh >> /var/log/aiogames-updates.log 2>&1
```

3. Save and exit. The system will now automatically check for updates.

### Method 2: PM2 Cron (if using PM2)

If you're using PM2 to manage your Node.js application:

```bash
# Install pm2-cron module
npm install -g pm2-cron

# Add a cron job to check every 6 hours
pm2 cron restart 0 "*/6 * * * *" --name "update-checker" -- /workspaces/AIOgames/scripts/check-updates.sh
```

### Method 3: Node.js Scheduler (Alternative)

For a pure Node.js solution, you could create a scheduled task within your application:

```javascript
// Add to your main application file
const cron = require('node-cron');

// Check for updates every 6 hours
cron.schedule('0 */6 * * *', async () => {
  try {
    const response = await fetch('http://localhost:3001/api/updates/check', {
      method: 'POST'
    });
    const result = await response.json();
    console.log('Update check result:', result);
  } catch (error) {
    console.error('Update check failed:', error);
  }
});
```

## Database Schema

### TrackedGame Model
```javascript
{
  gameId: String,           // Unique game identifier
  title: String,           // Game title
  source: String,          // Source (e.g., "gameapi")
  image: String,           // Game image URL
  description: String,     // Game description
  gameLink: String,        // Current link to game post
  lastKnownVersion: String, // Last known version/update
  lastVersionDate: String, // Date of last version
  dateAdded: Date,         // When game was added to tracking
  lastChecked: Date,       // Last time we checked for updates
  notificationsEnabled: Boolean, // Whether to send notifications
  checkFrequency: String,  // How often to check (daily, weekly, etc.)
  updateHistory: [{
    version: String,       // Version identifier
    dateFound: Date,       // When we found this update
    gameLink: String       // Link to the updated post
  }],
  isActive: Boolean        // Whether tracking is active
}
```

## API Endpoints

### GET /api/tracking
- Returns all tracked games for the current user

### POST /api/tracking
- Adds a new game to tracking
- Body: `{ gameId, title, source, image, description, gameLink }`

### DELETE /api/tracking?gameId={id}
- Removes a game from tracking

### POST /api/updates/check
- Manually trigger update check for all tracked games
- Returns number of games checked and updates found

### GET /api/updates/check
- Returns update check status and recent updates

## Usage

1. **Track a Game**: Go to the main page, search for games, and click "Track Game"
2. **View Tracked Games**: Click "Tracking Dashboard" to see all tracked games
3. **Manual Update Check**: In the tracking dashboard, click "Check for Updates"
4. **Automatic Updates**: Set up cron job using the instructions above

## Troubleshooting

- **No updates found**: Check that the external API is accessible and game titles match
- **Permission denied on script**: Run `chmod +x /workspaces/AIOgames/scripts/check-updates.sh`
- **Cron not working**: Check cron service is running with `systemctl status cron`
- **Database issues**: Ensure MongoDB is running and connection string is correct
- **API errors**: Check application logs and network connectivity to external API

## Future Enhancements

- Email/Discord notifications for updates
- Different check frequencies per game
- Update filtering (e.g., major versions only)
- RSS feed generation for updates
- Webhook support for real-time notifications