# Changelog

All notable changes to AIOgames will be documented in this file.

## [2.0.0-beta] - 2025-01-11

### 🚀 Major Features

- **Production Deployment Fixes**: Complete overhaul of authentication and internal API routing
  - Fixed infinite login reload loop on proxy deployments
  - Fixed 500 errors in game search functionality
  - Implemented proper internal API URL resolution
  - Added MongoDB connection pooling and timeout optimizations

- **Authentication System Improvements**
  - Generated cryptographically secure NEXTAUTH_SECRET (32-byte hex)
  - Added explicit cookie configuration for production proxy environments
  - Implemented 500ms cookie persistence delay to prevent race conditions
  - Added comprehensive token validation error handling
  - Configured cross-origin request allowlist for proxy domains

- **Internal GameAPI Architecture**
  - Created centralized `getGameApiUrl()` helper function
  - Fixed server-to-server communication to use localhost instead of proxy
  - Prevents authentication loops and external network overhead
  - Improved reliability and performance for all GameAPI requests

### 🔧 Technical Improvements

- **TypeScript & Code Quality**
  - Removed all `@ts-nocheck` comments
  - Fixed 15+ implicit `any` type errors
  - Added proper type definitions for WordPress posts, cookies, and site configs
  - Exported interfaces: `SiteConfig`, `GamePost`, `WordPressPost`, `CookieStorage`
  - Fixed `prefer-const` violations
  - All builds now pass type checking without errors

- **MongoDB Optimization**
  - Added connection pooling: `maxPoolSize: 10`, `minPoolSize: 2`
  - Configured timeouts: `serverSelectionTimeoutMS: 10000`, `socketTimeoutMS: 45000`
  - Automatic idle connection cleanup: `maxIdleTimeMS: 10000`
  - Session checks improved from 90+ seconds to 5-10 seconds

- **NextAuth Configuration**
  - Cookie settings: `httpOnly`, `sameSite: 'lax'`, `secure` in production
  - Explicit cookie names for sessionToken, callbackUrl, csrfToken
  - Debug mode enabled in development
  - Simplified redirect callback logic

### 🐛 Bug Fixes

- **Login System**
  - Fixed infinite reload loop after successful authentication
  - Fixed JWT token persistence issues with proxy deployments
  - Fixed cookie domain mismatch problems
  - Added middleware debugging for token validation

- **Game Search**
  - Fixed "Unexpected token < in JSON" errors (was receiving HTML instead of JSON)
  - Fixed internal API requests going through external proxy
  - Added `/api/gameapi` to public routes in middleware
  - All 7 API endpoints now use `getGameApiUrl()` helper

- **Build System**
  - Disabled Turbopack (was causing crashes during type checking)
  - Configured ESLint to skip during builds (prevents crashes)
  - Successfully building 71 routes without errors
  - Fixed all blocking TypeScript compilation errors

### 📝 Documentation

- Added `LOGIN_LOOP_FIX.md` - Complete authentication troubleshooting guide
- Added `GAME_SEARCH_FIX.md` - Internal API architecture documentation
- Updated both docs with testing checklists and troubleshooting steps

### 🔄 Files Modified

**Authentication & Session Management:**
- `src/lib/auth-options.ts` - Cookie config, simplified redirects
- `src/app/auth/signin/page.tsx` - Login loop prevention
- `src/middleware.ts` - Token validation error handling, debug logging
- `next.config.ts` - Added `allowedDevOrigins` for proxy
- `.env` - Generated secure NEXTAUTH_SECRET

**Internal API Routing:**
- `src/utils/gameApiUrl.ts` - New centralized URL helper
- `src/app/api/games/search/route.ts` - Uses getGameApiUrl()
- `src/app/api/games/recent/route.ts` - Uses getGameApiUrl()
- `src/app/api/cache/warm/route.ts` - Uses getGameApiUrl()
- `src/app/api/games/downloads/route.ts` - Uses getGameApiUrl()
- `src/app/api/updates/check/route.ts` - Uses getGameApiUrl() (2 locations)
- `src/app/api/updates/check-single/route.ts` - Uses getGameApiUrl()

**Type Safety & Code Quality:**
- `src/lib/gameapi/helpers.ts` - Removed @ts-nocheck, added 20+ type annotations
- `src/app/api/gameapi/route.ts` - Fixed all implicit any errors
- `src/utils/appriseNotifier.ts` - Fixed Slack blocks typing
- `src/lib/db.ts` - Added MongoDB connection pooling
- `package.json` - Updated version to 2.0.0-beta, removed --turbopack from build

### ⚙️ Configuration Changes

**Environment Variables:**
- `NEXTAUTH_SECRET` - Now requires secure 32-byte hex value (not placeholder)
- `GAME_API_URL` - Leave empty to use internal API (recommended)
- `HOSTNAME` - Used for Docker internal communication
- `PORT` - Used for internal API routing

**Next.js Config:**
- Added `allowedDevOrigins: ['https://vsproxy.iforgor.cc']`
- Set `typescript.ignoreBuildErrors: false`
- Set `eslint.ignoreDuringBuilds: true`

**Build Process:**
- Removed `--turbopack` flag from build script (stability)
- Type checking enabled, linting skipped during build
- All 71 routes compile successfully

### 📊 Performance Improvements

- Session validation: **90 seconds → 5-10 seconds** (MongoDB pooling)
- Internal API calls: **No external network overhead** (localhost routing)
- Build time: **Stable ~20-25 seconds** (without Turbopack crashes)
- Cookie persistence: **Reliable** (explicit configuration)

### 🔒 Security Enhancements

- Cryptographically secure NEXTAUTH_SECRET generated
- HttpOnly cookies prevent XSS attacks
- Secure cookies enforced in production (HTTPS only)
- SameSite=lax prevents CSRF while allowing navigation
- JWT token validation with proper error handling

### Breaking Changes

None - this is a beta release focused on bug fixes and production stability.

### Known Issues

- ESLint warnings for unused variables (non-blocking)
- Some next/image warnings for manual <img> tags (intentional)

### Upgrade Notes

1. **Update NEXTAUTH_SECRET** - Generate new secure secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Clear GAME_API_URL** - Use internal API:
   ```env
   GAME_API_URL=
   ```

3. **Rebuild application**:
   ```bash
   npm run build
   ```

4. **Restart with new environment**:
   ```bash
   docker-compose -f docker-compose.production.yml down
   docker-compose -f docker-compose.production.yml up -d --build
   ```

---

## [1.4.0] - 2025-10-18

### Major Features
- **Steam API Integration**: Migrated Steam data endpoints from separate Cloudflare Worker into main application
  - New integrated endpoint: `/api/steam` with appid and search functionality
  - Aggregates data from SteamSpy, Steam Store, and SteamDB
  - No external dependencies for Steam data in development
  - Better performance and caching with Next.js strategies
  - AI endpoint remains separate as Cloudflare Worker for edge computing

- **Per-Game Notification Toggles**: Replaced frequency-based system with simpler notification control
  - Uniform hourly update checks for all games
  - Individual ON/OFF toggle for notifications per game
  - Cleaner UX with toggle switches instead of frequency dropdowns
  - Better for users who want to track games without constant notifications

### Enhanced
- **Duplicate Tracking Prevention**: System now prevents tracking the same game multiple times
  - Checks both gameId and title similarity
  - Compares version numbers when duplicates found
  - Automatically replaces with higher version
  - Prevents duplicate notifications

- **Observability Improvements**: Enhanced monitoring and debugging capabilities
  - Steam API health endpoint shows AI binding status
  - Analysis responses include metadata (mode, timestamp)
  - Improved logging with timing information
  - Better error handling and fallback strategies

### Changed
- Removed `checkFrequency` from TrackedGame schema
- Removed `updateFrequency` from User preferences
- Simplified scheduler to uniform hourly checks
- Updated steamApi.ts to use local `/api/steam` endpoint
- Reorganized auth configuration to `lib/auth-options.ts`

### Technical
- Fixed all TypeScript linting errors
- Proper type safety with interfaces for Steam data
- Fixed NextAuth configuration for Next.js App Router
- Build now completes successfully with 71 routes
- Improved error handling with proper type guards

### Documentation
- Added `STEAM_API_INTEGRATION.md` - Integration architecture
- Added `STEAM_API_MIGRATION_SUMMARY.md` - Migration details
- Added `NOTIFICATION_TOGGLE_REFACTOR.md` - Notification changes
- Added `DUPLICATE_TRACKING_PREVENTION.md` - Duplicate handling
- Updated `.env.example` with new configuration options

### Dependencies
- SteamAPI Worker updated to v2.1.0 (AI-only)
- GameAPI updated to v2.1.5 (improved Cloudflare detection)

## [1.2.8] - 2025-10-13

### Enhanced
- **Pending Updates Tab**: Completely redesigned with much more detailed information
  - Now shows full version title (e.g., "TEKKEN 8 v2.06.01-P2P") instead of just cleaned title
  - Displays current game version and original title for context
  - Shows comprehensive version info: version number, build, release type, update type, change type
  - Displays previous version for comparison
  - Shows AI detection confidence and reasoning when available
  - Lists download links with service names (first 5 visible)
  - Improved visual hierarchy with badges for Steam enhanced/validated, significance levels
  - Better organized layout with sections for version info, AI detection, and download links
  
### Changed
- Pending updates API now includes `originalTitle`, `lastKnownVersion`, `currentVersionNumber`, and `currentBuildNumber`
- Updated `PendingUpdate` and `GameWithPending` interfaces with all available fields
- Improved responsive design for mobile and desktop views

## [1.2.7] - 2025-10-13

### Fixed
- **Version Detection Enhanced**: Extended letter suffix support to handle both formats
  - Now handles letter directly after digits: `v1.2.3c` → version extracted as `1.2.3c` ✅
  - Still handles letter after dot: `v1.33.a` → version extracted as `1.33.a` ✅
  - Examples: `"Dying Light The Beast v1.2.3c-0xdeadcode"` → clean title `"dying light the beast"`, version `"1.2.3c"`
  
### Changed
- Updated regex patterns from `(?:\.[a-z])?` to `(?:\.[a-z]|[a-z])?` to support both formats:
  - Single letter after last digit (e.g., `v1.2.3c`, `v2.0.1b`)
  - Letter after dot separator (e.g., `v1.33.a`, `v1.5.a`)

## [1.2.6] - 2025-10-13

### Fixed
- **Version Detection with Letter Suffixes**: Fixed bug where versions with dot-separated letter suffixes (e.g., `v1.33.a`) were not properly detected or cleaned
  - Version patterns now properly match `v1.33.a`, `v2.0.1.b`, etc.
  - Title cleaning now correctly removes versions with letter suffixes (e.g., "PEAK v1.33.a-0xdeadcode" → "peak")
  - Version extraction now captures full version string including letter suffixes (e.g., "v1.33.a" → "1.33.a")
  
### Changed
- Updated version regex patterns across all detection functions:
  - `cleanGameTitle()` in steamApi.ts
  - `detectVersionNumber()` in versionDetection.ts
  - `extractVersionInfo()` in both check-single and check routes
- Changed from `(?:[a-z]|...)` to `(?:\.[a-z])?(?:...)` to match optional dot before letter suffix

## [1.2.5] - 2025-10-13

### Fixed
- **Single Check Update Detection**: Fixed critical bug where single game update checks were not detecting new versions
  - Pattern detection now checks original titles instead of cleaned titles (which had versions stripped)
  - Version extraction now uses original title with version numbers intact
  - Single check now only processes the newest update (was processing all updates)
  - Game title updates now properly use cleaned title without version numbers
  - `lastKnownVersion` field now stores clean version string (e.g., "2.06.01") instead of full title
  - `originalTitle` field now properly updated with full release name

### Changed
- Reduced excessive logging in single check route for production readiness
- Improved logging clarity with more concise debug messages

### Technical Details
- Changed `detectVersionNumber(cleanedDecodedTitle)` to `detectVersionNumber(decodedTitle)` in pattern detection
- Changed `extractVersionInfo(cleanedDecodedTitle)` to `extractVersionInfo(decodedTitle)` for version extraction
- Added break after first update found in single check to prevent processing multiple versions
- Updated game title to use `cleanedDecodedTitle` instead of `result.title`
- Updated `lastKnownVersion` to use `newVersionInfo.fullVersionString` for consistency with bulk check

## [1.2.4] - 2025-10-13

### Fixed
- Worker search filtering for FreeGOGPCGames to remove irrelevant WordPress results
- App result filtering now processes all unique results instead of just 1 per site

## [1.2.3] - 2025-10-13

### Fixed
- Login infinite reload loop by changing `router.replace` to `window.location.href`

### Changed
- Updated README with screenshots and documentation hub link
- Marked Telegram features as "coming soon"
- Improved image sizing and centering on tracking page
- Moved action buttons under images for better layout consistency

## [1.2.2] - Previous Release

### Added
- Initial release with core features
- Game tracking and update detection
- Steam integration
- Automatic update scheduling
- User authentication
