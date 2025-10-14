# Changelog

All notable changes to AIOgames will be documented in this file.

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
