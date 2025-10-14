# GOG Priority Integration (v1.3.0)

## Overview
GOG.com integration with **PRIORITY over Steam** for game version tracking. When a game is tracked and exists on both GOG and Steam, GOG version information takes precedence.

## Features

### 1. Automatic GOG Verification on Game Add
When adding a game to tracking:
1. **GOG Search FIRST** - Searches GOGDB SQLite index for matches
2. **Steam Search SECOND** - Falls back to Steam if needed
3. **Dual Verification** - If found on both platforms, stores both IDs
4. **Auto-Version Detection** - Automatically retrieves latest GOG version

### 2. GOGDB SQLite Index
- **Fast Local Searches**: Uses `sql.js` for pure JavaScript SQLite
- **Auto-Download**: Downloads index from `https://www.gogdb.org/data/index.sqlite3`
- **Auto-Update**: Refreshes every 24 hours
- **Smart Ranking**: Exact match > prefix match > partial match
- **API Fallback**: Falls back to GOGDB API if builds data missing from index

### 3. Advanced Mode Display
In tracking page advanced mode:
- **GOG Latest Version**: Shows above Steam version with **PRIORITY** badge
- **Purple Highlighting**: GOG versions displayed in purple to differentiate from Steam (blue/emerald)
- **Build Information**: Shows both version string and build ID
- **Last Updated Date**: Displays when GOG version was published

### 4. GOG Verification Component
- **Auto-Verify**: Automatic search on game add
- **Manual Search**: Search GOG database manually
- **Version Tracking**: Check for latest GOG versions
- **Remove Verification**: Unlink GOG product if needed

## Implementation Details

### Database Fields (TrackedGame model)
```typescript
gogVerified: Boolean        // Is game verified on GOG?
gogProductId: Number        // GOG product ID
gogName: String            // GOG game title
gogVersion: String         // Latest GOG version
gogBuildId: String         // Latest GOG build ID
gogLastChecked: Date       // Last check timestamp
```

### API Endpoints

#### `/api/tracking` POST
- Auto-searches GOG FIRST before Steam
- Stores GOG verification data if found
- Falls back to Steam if GOG not found

#### `/api/gogdb`
- `action=search`: Search GOGDB index
- `action=version`: Get latest version for product
- `action=product`: Get product details
- `action=compare`: Compare current vs latest version
- `action=update-index`: Manually refresh index

#### `/api/games/gog-verify`
- `POST`: Add GOG verification to game
- `DELETE`: Remove GOG verification

### UI Components

#### GOGVerification Component
```tsx
<GOGVerification
  gameId={string}
  gameTitle={string}
  gogName={string}
  gogVerified={boolean}
  onVerificationUpdate={(gameId, verified, productId, name, version, buildId) => void}
/>
```

#### Advanced Mode Display
```tsx
{/* GOG Latest - PRIORITY OVER STEAM */}
{showAdvanced && game.gogVerified && gogLatest[game._id] && (
  <div className="mt-2 text-xs flex items-center gap-2">
    <span className="font-semibold">GOG Latest:</span>
    {gogLatest[game._id].version && (
      <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded">
        v{gogLatest[game._id].version}
      </span>
    )}
    <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-[10px] font-bold">
      PRIORITY
    </span>
  </div>
)}
```

## Why GOG Priority?

1. **Steam Can Be Wrong**: Steam versions sometimes differ from actual release versions
2. **DRM-Free Accuracy**: GOG versions are typically the official DRM-free releases
3. **Better for Tracking**: GOG build IDs and versions are more reliable
4. **User Preference**: GOG users prefer tracking against GOG versions

## Technical Stack

- **sql.js**: Pure JavaScript SQLite (no native compilation needed)
- **GOGDB Index**: ~40MB SQLite database with game metadata
- **CDN WASM**: Loads sql.js WASM from https://sql.js.org/dist/
- **Lazy Loading**: Index initialized on first use, not on app startup
- **Version**: 1.3.0

## Performance

- **Local Search**: 100x+ faster than HTTP requests
- **Bandwidth**: Downloads index once, reuses for 24 hours
- **Fallback**: API requests only when index lacks data
- **Caching**: Browser caches steamdb/gogdb requests

## Future Enhancements

- [ ] GOG version comparison in update detection
- [ ] GOG-only tracking mode
- [ ] Multi-platform version display (Windows/Mac/Linux)
- [ ] GOG changelog integration
- [ ] Automatic GOG version notifications
