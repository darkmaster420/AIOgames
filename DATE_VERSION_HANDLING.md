# Date-Based Version Handling

## Overview

Special handling has been implemented for games that use date-based versioning like "soma v20250922". This ensures proper version detection, validation, and comparison for titles that use dates as version numbers.

## Supported Date Formats

The system now recognizes these date-based version patterns:

### Primary Formats
- `v20250922` - 8-digit date format (YYYYMMDD)
- `v2025.09.22` - Dotted date format (YYYY.MM.DD)
- `v2025-09-22` - Hyphenated date format (YYYY-MM-DD)

### Additional Supported Formats
- `20250922` - Without 'v' prefix
- `2025.09.22` - Dotted format without prefix
- `2025-09-22` - Hyphenated format without prefix

## Enhanced Features

### 1. **Improved Version Detection**
- Date patterns are now prioritized in version detection
- Added to both main update checker and single-game checker
- Compatible with existing semantic versioning

### 2. **Smart Version Comparison**
- Date versions are compared chronologically (newer dates = newer versions)
- Mixed comparisons (date vs semantic) use intelligent numeric fallback
- Normalizes different date formats for consistent comparison

### 3. **Validation Support**
- Date-based versions pass validation checks
- Normalized to consistent YYYYMMDD format internally
- Clear error messages include date-based examples

### 4. **Auto-Approval Logic**
- Date-based versions work with auto-approval systems
- Proper significance scoring (date updates = medium significance)
- Integrates with Steam verification and build number systems

## Implementation Details

### Pattern Priority
1. Date-based patterns (highest priority)
2. Semantic versioning patterns
3. Build number patterns
4. Fallback patterns

### Version Types
- `date_version` - Pure date-based version comparison
- `mixed_version` - Mixed date/semantic version comparison
- `version` - Standard semantic version comparison

### Comparison Logic
```javascript
// Example: soma v20250922 vs soma v20250923
oldDate = "20250922"
newDate = "20250923" 
result = newDate > oldDate // true (is newer)
significance = 2 // medium significance
changeType = "date_version"
```

## Use Cases

### Perfect For
- Daily builds with date stamps
- Games with timestamp-based releases
- Nightly builds or snapshots
- Development versions with date identifiers

### Examples
- `soma v20250922` → `soma v20250923` ✅ (detected as update)
- `game v2025.09.22` → `game v2025.09.23` ✅ (detected as update)
- `title v20250922` → `title v1.5.0` ⚠️ (mixed comparison)

## Compatibility

✅ **Fully Compatible With:**
- Existing semantic versioning (v1.2.3)
- Build number detection
- Steam verification system
- Auto-approval logic
- Update notifications

⚠️ **Mixed Format Handling:**
- When comparing date vs semantic versions, uses numeric fallback
- May require manual verification for mixed cases

## Configuration

No additional configuration required. The system automatically detects and handles date-based versions when encountered.

## Testing

The implementation has been tested with:
- Various date formats (dots, hyphens, no separators)
- Version comparison edge cases
- Mixed version type scenarios
- Integration with existing systems

All tests pass and the system maintains backward compatibility with existing version detection logic.