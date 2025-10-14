# Single Check Update Detection - Bug Fix Summary

## Latest Update (v1.2.7)

### Enhanced Version Suffix Support
Extended letter suffix handling to support both common formats found in game releases:

**Formats Supported:**
- Letter directly after digits: `v1.2.3c`, `v2.0.1b` → extracts `1.2.3c`, `2.0.1b`
- Letter after dot: `v1.33.a`, `v1.5.a` → extracts `1.33.a`, `1.5.a`

**Example:**
```
Input: "Dying Light The Beast v1.2.3c-0xdeadcode"
Clean Title: "dying light the beast" ✅
Version: "1.2.3c" ✅
```

**Regex Change:**
```typescript
// Before (only handled .a format)
(?:\.[a-z])?

// After (handles both .a and c formats)
(?:\.[a-z]|[a-z])?
```

---

## Issue
The single game update check feature was completely non-functional. Despite the bulk check working correctly, the single check route would find search results, pass all pattern and similarity checks, but fail to detect any updates.

## Root Causes

### 1. Pattern Detection on Cleaned Titles
**Location**: Line 519 in `check-single/route.ts`

**Problem**: 
```typescript
const { found: hasVersion } = detectVersionNumber(cleanedDecodedTitle);
```

The code was checking for version patterns in `cleanedDecodedTitle`, which had already been processed by `cleanGameTitle()` that strips all version numbers. This meant the pattern detection could never find versions.

**Solution**:
```typescript
const { found: hasVersion } = detectVersionNumber(decodedTitle);
```

Changed to check the original decoded title that still contains version information.

---

### 2. Version Extraction on Cleaned Titles
**Location**: Line 564 in `check-single/route.ts`

**Problem**:
```typescript
const newVersionInfo = extractVersionInfo(cleanedDecodedTitle);
```

Similarly, version extraction was attempting to parse version information from a title that had versions already removed.

**Solution**:
```typescript
const newVersionInfo = extractVersionInfo(decodedTitle);
```

Extract version info from the original title with versions intact.

---

### 3. Processing All Updates Instead of Newest
**Location**: Update processing loop in `check-single/route.ts`

**Problem**: The single check would process and add all 4 newer versions (v2.06.01, v2.05.00, v2.04.00, v2.03.02) instead of just the newest one.

**Solution**: Added break statement after finding first update:
```typescript
const status = autoApproveResult.canApprove ? '✅ Auto-approved' : '📝 Added pending';
logger.info(`${status} update for ${game.title}: ${newVersionInfo.fullVersionString}`);

// For single check, only process the first (newest) update
break;
```

---

### 4. Game Title Not Cleaned
**Location**: Line 756 in `check-single/route.ts`

**Problem**:
```typescript
title: result.title,
```

When updating the game, it was using the raw search result title (e.g., "TEKKEN 8 v2.06.01-P2P") instead of the cleaned game name.

**Solution**:
```typescript
title: cleanedDecodedTitle,
originalTitle: decodedTitle,
```

Now uses the cleaned title for display and stores the full title in `originalTitle`.

---

### 5. lastKnownVersion Format
**Location**: Line 753 in `check-single/route.ts`

**Problem**:
```typescript
lastKnownVersion: decodedTitle,
```

Was storing the full release title instead of just the version number.

**Solution**:
```typescript
lastKnownVersion: newVersionInfo.fullVersionString || newVersionInfo.version || newVersionInfo.build || decodedTitle,
```

Now stores a clean version string like "2.06.01" or "2.06.01 Build 12345", consistent with bulk check behavior.

---

## Testing Results

### Before Fix
- ❌ Single check found 0 updates
- ❌ Pattern detection passed but version comparison never executed
- ❌ No updates detected despite newer versions available

### After Fix
- ✅ Single check finds newest update (v2.06.01)
- ✅ Properly auto-approves update
- ✅ Game title cleaned correctly ("tekken 8")
- ✅ Last known version stored correctly ("2.06.01")
- ✅ Original title preserved ("TEKKEN 8 v2.06.01-P2P")
- ✅ Only processes newest version, stops after first match

---

## Code Quality Improvements

### Logging Cleanup
Reduced excessive INFO-level logging to improve production logs:
- Changed verbose pattern/similarity logging to DEBUG level
- Kept essential INFO logs for update detection results
- Improved log clarity and conciseness

### Consistency with Bulk Check
The single check now follows the same patterns as bulk check:
- Uses `fullVersionString` for `lastKnownVersion`
- Stores cleaned title in `title` field
- Preserves full release name in `originalTitle`
- Proper version extraction from original titles

---

## Files Modified
1. `/src/app/api/updates/check-single/route.ts` - Main bug fixes and logging cleanup
2. `/package.json` - Version bump to 1.2.5
3. `/CHANGELOG.md` - Created with detailed changelog

---

## Impact
This fix restores full functionality to the manual single game update check feature, allowing users to:
- Immediately check for updates without waiting for scheduled bulk checks
- Get clean, properly formatted version information
- See updates auto-approved when appropriate
- Have consistent data format across bulk and single checks
