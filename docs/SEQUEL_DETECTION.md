# Sequel and Variant Detection System

## Overview

The app now automatically detects and handles game sequels, variants, and expansions that have similar names to prevent tracking conflicts.

## Problem Solved

Previously, games like these would cause confusion:
- **Assetto Corsa** vs **Assetto Corsa Evo**
- **Hollow Knight** vs **Hollow Knight Silksong**  
- **Resident Evil 2** vs **Resident Evil 2 Remake**
- **Cities Skylines** vs **Cities Skylines 2**

When cleaned titles were generated (removing version numbers, etc.), these games could be mistakenly treated as duplicates because one title is a subset of the other.

## Solution

### 1. Title Relationship Detection (`areTitlesRelated`)

Detects when one game title is a subset of another with extra words:
- Compares cleaned titles word-by-word
- Checks if all words from the shorter title appear in order in the longer title
- Example: "hollow knight" matches within "hollow knight silksong"

### 2. Steam API Differentiation (`differentiateRelatedGames`)

When related titles are detected:
1. Searches Steam API for both games
2. Compares their Steam App IDs
3. If IDs differ → They are distinct games
4. Returns Steam info for both games

### 3. Conflict Detection (`detectAndResolveGameConflicts`)

Before adding a new game to tracking:
1. Checks all user's tracked games for similar titles
2. If similarity detected, calls Steam API to differentiate
3. Automatically resolves the correct Steam App ID
4. Prevents false duplicate errors

## How It Works

### Tracking Flow

```
User tries to track: "Assetto Corsa Evo"
                     ↓
App checks existing tracked games
                     ↓
Finds: "Assetto Corsa" (already tracked)
                     ↓
Detects: Titles are related (subset match)
                     ↓
Queries Steam API for both:
  - Assetto Corsa → Steam ID: 244210
  - Assetto Corsa Evo → Steam ID: 1870050
                     ↓
Different IDs = Distinct games ✅
                     ↓
Stores "Assetto Corsa Evo" with Steam ID 1870050
                     ↓
Both games now tracked separately!
```

### Error Handling

If games cannot be differentiated:
- Returns HTTP 409 (Conflict) with helpful message
- Suggests that games need unique Steam App IDs
- Prevents accidental duplicate tracking

## Code Locations

### New Functions (src/utils/steamApi.ts)

1. **`areTitlesRelated(title1, title2)`**
   - Checks if titles are sequels/variants
   - Returns boolean

2. **`differentiateRelatedGames(title1, title2)`**
   - Uses Steam API to differentiate
   - Returns Steam IDs and names

3. **`detectAndResolveGameConflicts(newTitle, existingGames)`**
   - Main conflict detection
   - Automatically resolves Steam info
   - Returns conflict status and resolved data

### Modified Files

- **src/utils/steamApi.ts** - Added detection functions
- **src/app/api/tracking/route.ts** - Integrated conflict detection before saving games

## Benefits

✅ **Automatic differentiation** - No manual intervention needed  
✅ **Steam verified** - Uses official Steam App IDs  
✅ **Prevents duplicates** - Catches similar games before they cause issues  
✅ **User-friendly** - Clear error messages if games can't be differentiated  
✅ **Scalable** - Works for any number of sequels/variants  

## Examples

### Success Cases

| Existing Game | New Game | Result |
|--------------|----------|--------|
| Assetto Corsa | Assetto Corsa Evo | ✅ Both tracked separately |
| Hollow Knight | Hollow Knight Silksong | ✅ Both tracked separately |
| Resident Evil 2 | Resident Evil 2 Remake | ✅ Both tracked separately |
| Cities Skylines | Cities Skylines 2 | ✅ Both tracked separately |
| Dragon Ball | Dragon Ball Sparking Zero | ✅ Both tracked separately |

### Edge Cases Handled

- **Identical titles** - Not treated as related (same game)
- **Completely different games** - Not flagged as related
- **Multiple word games** - Proper subset matching
- **Failed Steam API** - Graceful error handling with helpful message

## Testing

Run the test script:
```bash
node test-sequel-detection.js
```

This validates:
- Title relationship detection logic
- Subset matching algorithm
- Edge case handling
- False positive prevention

## Future Enhancements

Possible improvements:
- Cache Steam differentiation results
- Add manual override for edge cases
- Support for DLC/expansion detection
- Integration with GOG for non-Steam games
