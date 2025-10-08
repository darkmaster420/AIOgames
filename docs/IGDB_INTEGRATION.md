# IGDB Integration for Unreleased Games

This document explains how to set up IGDB (Internet Game Database) integration to support tracking unreleased and upcoming games.

## What is IGDB Integration?

IGDB integration allows users to add unreleased or upcoming games to their tracking list even when these games aren't available on piracy sites yet. When a user searches for a game and no suitable matches are found on piracy sites, the system will automatically search IGDB as a fallback.

## Setup Instructions

### 1. Create a Twitch Application

IGDB uses Twitch authentication since it's owned by Twitch.

1. Go to https://dev.twitch.tv/console
2. Log in with your Twitch account
3. Click "Create App" or "Register Your Application"
4. Fill in the application details:
   - **Name**: AIOgames IGDB Integration (or any name you prefer)
   - **OAuth Redirect URLs**: `http://localhost` (this won't be used but is required)
   - **Category**: Application Integration
5. Click "Create"
6. Copy the **Client ID** and **Client Secret**

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
# IGDB (Internet Game Database) - For unreleased games
IGDB_CLIENT_ID=your-twitch-client-id-here
IGDB_CLIENT_SECRET=your-twitch-client-secret-here
```

### 3. How It Works

1. **User searches for a game** using the "Add Custom Game" feature
2. **System searches piracy sites first** (as usual)
3. **If no suitable matches found**, system automatically searches IGDB
4. **IGDB results are ranked by similarity** and the best match is selected
5. **Game is added with source "IGDB"** and special handling for unreleased status

## Features

- **Automatic fallback**: Seamlessly searches IGDB when piracy sites don't have matches
- **Smart matching**: Uses similarity scoring to find the best IGDB match
- **Unreleased game handling**: Special tracking for games that haven't been released yet
- **Rich metadata**: Includes game descriptions, cover images, release dates, and genres from IGDB
- **Future-proof**: Games added from IGDB will be detected when they become available on piracy sites

## User Experience

### Before IGDB Integration
- User searches for "Ananta" (unreleased game)
- System: "No games found matching 'Ananta'"
- User can't track the game

### After IGDB Integration
- User searches for "Ananta"
- System searches piracy sites (no results)
- System automatically searches IGDB
- System finds "Ananta" and adds it to tracking
- User gets notification: "Successfully added upcoming/unreleased game 'Ananta' from IGDB to your tracking list (85% match). You'll be notified when it becomes available on piracy sites."

## Error Handling

- **Missing credentials**: System continues without IGDB, shows original error message
- **IGDB API errors**: System logs error and continues with original flow
- **No IGDB matches**: System shows comprehensive error message including both piracy site and IGDB results
- **Token refresh**: Automatically handles Twitch OAuth token refresh

## Notes

- IGDB integration is completely optional - the system works fine without it
- No additional dependencies required
- Games from IGDB are clearly marked in the UI
- Update detection for IGDB games will be limited until they're released
- The system will automatically detect when IGDB games become available on piracy sites