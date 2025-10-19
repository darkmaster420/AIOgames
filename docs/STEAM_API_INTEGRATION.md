# Steam API Integration

This document describes how the Steam API functionality has been integrated into the AIOgames application.

## Overview

The Steam API functionality has been **migrated from a separate Cloudflare Worker into the main AIOgames application**. This provides:

- **Unified deployment**: No need to manage a separate worker for Steam data
- **Local development**: Steam API calls work seamlessly in development
- **Better integration**: Direct access to Steam data without external dependencies
- **AI endpoint separation**: The AI-powered update detection remains as a separate Cloudflare Worker

## Architecture

### Integrated Endpoints (in AIOgames)

These endpoints are now part of the main AIOgames application at `/api/steam`:

1. **App Details**: `/api/steam?action=appid&id={appid}`
   - Aggregates data from SteamSpy, Steam Store, and SteamDB
   - Returns game information, build history, and patch notes

2. **Search**: `/api/steam?action=search&q={query}`
   - Searches for games by name or appid
   - Falls back between SteamSpy and Steam Web API for best results

3. **Info**: `/api/steam`
   - Returns API information and available endpoints

### Separate AI Worker (Cloudflare)

The AI-powered game update detection remains as a separate Cloudflare Worker because it requires:
- Cloudflare AI binding (Workers AI)
- Edge computing for fast AI inference
- Cannot run locally without Cloudflare infrastructure

**AI Endpoint**: `https://your-ai-worker.workers.dev/ai`
- Analyzes game titles to detect updates
- Uses Cloudflare's Llama 3.3 70B model
- See `SteamAPI/src/index.js` for implementation

## Usage

### In AIOgames Code

The `src/utils/steamApi.ts` utility automatically uses the integrated API:

```typescript
import { getSteamAppDetails, searchSteamGames, resolveBuildFromVersion } from '@/utils/steamApi';

// Get game details with builds
const details = await getSteamAppDetails('570'); // Dota 2
console.log(details.name); // "Dota 2"
console.log(details.builds); // Array of recent builds

// Search for games
const results = await searchSteamGames('dota');
console.log(results.results); // Array of matching games

// Resolve build ID from version
const buildId = await resolveBuildFromVersion('570', '7.37');
```

### Direct HTTP Calls

You can call the integrated API directly:

```bash
# Get game details
curl "http://localhost:3002/api/steam?action=appid&id=570"

# Search for games
curl "http://localhost:3002/api/steam?action=search&q=dota"

# API info
curl "http://localhost:3002/api/steam"
```

## Configuration

### Environment Variables

The Steam API endpoints are configured via environment variables:

```bash
# Optional: Override the Steam API base URL (defaults to /api/steam)
NEXT_PUBLIC_STEAM_API_BASE=/api/steam
STEAM_API_BASE=/api/steam

# For Node.js scripts/tests, set the full app URL
NEXT_PUBLIC_APP_URL=http://localhost:3002
```

### Default Behavior

- **In browser/Next.js**: Uses relative URL `/api/steam`
- **In Node.js scripts**: Uses `http://localhost:3002/api/steam`
- **In production**: Uses the deployed app's domain

## Migration from Standalone SteamAPI

The SteamAPI Cloudflare Worker has been **streamlined to only include the AI endpoint**:

**Before**:
```bash
curl "https://your-steamapi.workers.dev/search?q=game"
curl "https://your-steamapi.workers.dev/appid/570"
curl "https://your-steamapi.workers.dev/ai" -d '...'
```

**After**:
```bash
# Steam data endpoints - Now in AIOgames
curl "http://your-app/api/steam?action=search&q=game"
curl "http://your-app/api/steam?action=appid&id=570"

# AI endpoint - Still separate Cloudflare Worker
curl "https://your-ai-worker.workers.dev/ai" -d '...'
```

## Benefits

1. **Simplified deployment**: One less service to deploy and maintain
2. **Faster local development**: No need for separate worker tunnels
3. **Better caching**: Can use Next.js's built-in caching strategies
4. **Easier debugging**: All code in one place
5. **Cost reduction**: Fewer Cloudflare Worker invocations
6. **Maintained separation**: AI endpoint remains on Cloudflare for optimal performance

## Implementation Details

### File Structure

```
AIOgames/
  src/
    app/api/steam/
      route.ts              # Integrated Steam API endpoints
    utils/
      steamApi.ts           # Utility functions (uses integrated API)

SteamAPI/
  src/
    index.js                # AI-only Cloudflare Worker
    ai.js                   # AI analysis logic
    index.old.js            # Backup of old full implementation
```

### Key Changes

1. **steamApi.ts**: Updated to use `/api/steam` instead of external worker
2. **SteamAPI worker**: Stripped down to only include AI endpoint
3. **Middleware**: Added `/api/steam` to public routes (no auth required)
4. **Build extraction**: Fixed to extract build IDs from SteamDB descriptions

## Testing

Run the migration test script:

```bash
cd /config/code/AIOgames
npx tsx test-steam-migration.ts
```

This tests:
- Getting app details
- Resolving builds from versions
- Resolving versions from builds

## Rollback

If needed, the old SteamAPI implementation is backed up at:
```
/config/code/SteamAPI/src/index.old.js
```

To rollback:
```bash
cd /config/code/SteamAPI/src
mv index.js index.ai-only.js
mv index.old.js index.js
```

Then update `steamApi.ts` to point back to the worker URL.
