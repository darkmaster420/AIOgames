// Enhanced Update Detection System - Test Examples

/*
EXAMPLE GAME TITLES AND HOW THE SYSTEM DETECTS UPDATES:

1. VERSION UPDATES:
   Old: "Cyberpunk 2077 [v1.5.2]"
   New: "Cyberpunk 2077 [v1.6.0]"
   → Detected as: VERSION UPDATE (Major.Minor change, Significance: 2)

2. BUILD UPDATES:
   Old: "Elden Ring Build 1234567"
   New: "Elden Ring Build 1234890" 
   → Detected as: BUILD UPDATE (Build number change, Significance: 1)

3. RELEASE TYPE PROGRESSION:
   Old: "Half-Life 3 Beta v0.9"
   New: "Half-Life 3 Final v1.0"
   → Detected as: RELEASE TYPE + VERSION (Beta → Final, Significance: 3)

4. UPDATE/DLC DETECTION:
   Old: "The Witcher 3 GOTY v1.32"
   New: "The Witcher 3 GOTY v1.32 Blood and Wine DLC"
   → Detected as: DLC UPDATE (New DLC content, Significance: 3)

5. HOTFIX DETECTION:
   Old: "Baldur's Gate 3 v1.0.0"
   New: "Baldur's Gate 3 v1.0.1 Hotfix"
   → Detected as: HOTFIX (Critical patch, Significance: 2)

6. REPACK DETECTION:
   Old: "Game Title v2.1"
   New: "Game Title v2.1 FitGirl Repack"
   → Detected as: REPACK (Same version, different package, Significance: 1)

SUPPORTED VERSION PATTERNS:
- Semantic versions: v1.2.3, 2.0.1, Version 1.5
- Build numbers: Build 12345, b1023, #456
- Date versions: 2024.03.15, 20240315
- Release types: Alpha, Beta, RC, Final, Stable
- Update types: Patch, Hotfix, DLC, Expansion, Repack, GOTY

SIGNIFICANCE LEVELS:
- 3: Major version, DLC, Expansion (Most important)
- 2: Minor version, Hotfix, Release type upgrade
- 1: Patch version, Build update, Repack
- 0: No significant change detected

The system now intelligently distinguishes between:
✅ Actual version changes (1.0 → 1.1)
✅ Build number updates (Build 123 → Build 124)
✅ Release maturity (Alpha → Beta → Final)
✅ Content additions (DLC, Expansions)
✅ Critical fixes (Hotfixes)
✅ Package variations (Repacks)
*/

export const VERSION_DETECTION_EXAMPLES = {
  semanticVersion: {
    old: "Game v1.2.3",
    new: "Game v1.3.0", 
    result: "Minor version update detected"
  },
  buildNumber: {
    old: "Game Build 1234",
    new: "Game Build 1250",
    result: "Build update detected"
  },
  releaseProgression: {
    old: "Game Alpha v0.5",
    new: "Game Beta v0.6",
    result: "Release type progression + version update"
  },
  dlcDetection: {
    old: "Game v2.0",
    new: "Game v2.0 New DLC Pack",
    result: "DLC content addition detected"
  }
};