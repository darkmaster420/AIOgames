# Changelog

All notable changes to AIOgames will be documented in this file.

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
