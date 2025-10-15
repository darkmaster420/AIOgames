/**
 * Utility functions for detecting and parsing version and build numbers from game titles
 */

export interface VersionDetection {
  hasVersionNumber: boolean;
  hasBuildNumber: boolean;
  detectedVersion?: string;
  detectedBuild?: string;
  isDateVersion?: boolean;
  isStaleDateVersion?: boolean;
  dateValue?: Date;
  hasPreferredVersion?: boolean; // True if we found a non-date version when date version exists
  isDateBasedBuild?: boolean;
  hasPreferredBuild?: boolean; // True if we found an explicit build when ambiguous build exists
  suggestions: {
    shouldAskForBuild: boolean;
    shouldAskForVersion: boolean;
    message?: string;
  };
}

/**
 * Detect version numbers in title (e.g., v1.2.3, 1.0, 2.5.1, etc.)
 */

export function detectVersionNumber(title: string): { found: boolean; version?: string; isDateVersion?: boolean; isStaleDateVersion?: boolean; dateValue?: Date; hasPreferredVersion?: boolean; preferredVersion?: string } {
  // Note: dateVersionPatterns moved to specialized detection functions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dateVersionPatterns = [
    /\bv(\d{4})[-\.]?(\d{2})[-\.]?(\d{2})\b/i, // vYYYYMMDD or vYYYY.MM.DD or vYYYY-MM-DD
    /\bv(\d{8})\b/i, // vYYYYMMDD
    /\bv(\d{2})[-\.]?(\d{2})[-\.]?(\d{2})\b/i, // vYY.MM.DD or vYYMMDD
    /\bv(\d{6})\b/i, // vYYMMDD
  ];

  const regularVersionPatterns = [
    // Special patterns like v1.0a, v2.1b, v1.5-beta, v1.0alpha, v1.33.a, v1.2.3c (check these BEFORE simple patterns)
    /\bv(\d+(?:\.\d+)*(?:\.[a-z]|[a-z])?(?:\-?(?:alpha|beta|rc|final|release|hotfix|patch))?)\b/i,
    // v1.2.3, v1.2, v1.0.0 (simple numeric patterns) - exclude long numbers that look like dates
    /\bv(\d{1,2}(?:\.\d+){1,3})\b/i, // Require at least one dot and limit first number to 1-2 digits
    /\bv(\d{1,3})\b/i, // Single number versions (1-3 digits only)
    // Enhanced version patterns for scene releases
    /\bversion[\s\-\.]?(\d+(?:\.\d+){0,3}(?:\.[a-z]|[a-z])?(?:\-?(?:alpha|beta|rc|final|release|hotfix|patch))?)\b/i,
    /\bver[\s\-\.]?(\d+(?:\.\d+){0,3}(?:\.[a-z]|[a-z])?(?:\-?(?:alpha|beta|rc|final|release|hotfix|patch))?)\b/i,
    /\bupdate[\s\-\.]?(\d+(?:\.\d+){0,3})\b/i,  // Update 1.5, Update 2.0.1
    /\bpatch[\s\-\.]?(\d+(?:\.\d+){0,3})\b/i,   // Patch 1.2, Patch 3.0.1
    /\bhotfix[\s\-\.]?(\d+(?:\.\d+){0,3})\b/i,  // Hotfix 1.1, Hotfix 2.0.5
    /\brev[\s\-\.]?(\d+(?:\.\d+){0,3})\b/i,     // Rev 1.2, Rev 2.1.0
    /\br(\d+(?:\.\d+){0,3})\b/i,                // r1.5, r2.0.1
    // Enhanced bracketed and delimited versions
    /\[v?(\d+(?:\.\d+){1,3})\]/i,               // [v1.2.3], [1.2.3]
    /\-v?(\d+(?:\.\d+){1,3})\-/i,               // -v1.2.3-, -1.2.3-
    /\_v?(\d+(?:\.\d+){1,3})\_/i,               // _v1.2.3_, _1.2.3_
    // Scene-specific version patterns
    /\b(\d+\.\d+(?:\.\d+)*)\s*(?:repack|proper|real|uncut|extended|complete|goty|definitive)\b/i,
    /\b(?:repack|proper|real|uncut|extended|complete|goty|definitive)\s*(\d+\.\d+(?:\.\d+)*)\b/i,
    // 1.2.3 (standalone version numbers) - be more selective to avoid false positives
    /\b(\d{1,2}\.\d{1,3}(?:\.\d{1,3})*)\b/,    // Limit digit counts to avoid date confusion
    // Build-version combinations
    /\bb(\d+)v(\d+(?:\.\d+)*)/i,                // b1234v1.5
    /\bv(\d+(?:\.\d+)*)b(\d+)/i                 // v1.5b1234 (captures version part)
  ];

  let dateVersionResult: { found: boolean; version: string; isDateVersion: boolean; isStaleDateVersion?: boolean; dateValue?: Date } | null = null;
  let regularVersionResult: { found: boolean; version: string; isDateVersion: boolean; isStaleDateVersion?: boolean; dateValue?: Date } | null = null;

  // Check for regular versions first (these are preferred)
  for (const pattern of regularVersionPatterns) {
    const match = title.match(pattern);
    if (match) {
      regularVersionResult = { found: true, version: match[1], isDateVersion: false };
      break;
    }
  }

  // Check for date versions
  // vYYYYMMDD or vYYYY.MM.DD or vYYYY-MM-DD
  let match = title.match(/\bv(\d{4})[-\.]?(\d{2})[-\.]?(\d{2})\b/i);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const dateValue = new Date(year, month, day);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
    dateVersionResult = {
      found: true,
      version: match[0],
      isDateVersion: true,
      isStaleDateVersion: diffDays > 7,
      dateValue
    };
  }

  // vYYYYMMDD
  if (!dateVersionResult) {
    match = title.match(/\bv(\d{8})\b/i);
    if (match) {
      const year = parseInt(match[1].slice(0, 4), 10);
      const month = parseInt(match[1].slice(4, 6), 10) - 1;
      const day = parseInt(match[1].slice(6, 8), 10);
      const dateValue = new Date(year, month, day);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
      dateVersionResult = {
        found: true,
        version: match[0],
        isDateVersion: true,
        isStaleDateVersion: diffDays > 7,
        dateValue
      };
    }
  }

  // vYY.MM.DD or vYYMMDD
  if (!dateVersionResult) {
    match = title.match(/\bv(\d{2})[-\.]?(\d{2})[-\.]?(\d{2})\b/i);
    if (match) {
      let year = parseInt(match[1], 10);
      year += year < 50 ? 2000 : 1900; // assume 2000+ for 00-49, 1900+ for 50-99
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const dateValue = new Date(year, month, day);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
      dateVersionResult = {
        found: true,
        version: match[0],
        isDateVersion: true,
        isStaleDateVersion: diffDays > 7,
        dateValue
      };
    }
  }

  // vYYMMDD
  if (!dateVersionResult) {
    match = title.match(/\bv(\d{6})\b/i);
    if (match) {
      let year = parseInt(match[1].slice(0, 2), 10);
      year += year < 50 ? 2000 : 1900;
      const month = parseInt(match[1].slice(2, 4), 10) - 1;
      const day = parseInt(match[1].slice(4, 6), 10);
      const dateValue = new Date(year, month, day);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
      dateVersionResult = {
        found: true,
        version: match[0],
        isDateVersion: true,
        isStaleDateVersion: diffDays > 7,
        dateValue
      };
    }
  }

  // Return preferred version logic
  if (regularVersionResult && dateVersionResult) {
    // We have both - prefer regular version but include date version info
    return {
      ...regularVersionResult,
      hasPreferredVersion: true,
      preferredVersion: regularVersionResult.version,
      dateValue: dateVersionResult.dateValue,
      isStaleDateVersion: dateVersionResult.isStaleDateVersion
    };
  } else if (regularVersionResult) {
    // Only regular version
    return regularVersionResult;
  } else if (dateVersionResult) {
    // Only date version
    return dateVersionResult;
  }

  return { found: false };
}

/**
 * Detect build numbers in title (e.g., Build 12345, b12345, #12345)
 */
export function detectBuildNumber(title: string): { found: boolean; build?: string; isDateBasedBuild?: boolean; hasPreferredBuild?: boolean } {
  const explicitBuildPatterns = [
    // Build 12345, Build#12345 - these are clearly marked as builds
    /\bbuild[\s\-\#\.]?(\d+)\b/i,
    // b12345, B12345 - explicitly marked with 'b'
    /\bb(\d{4,})\b/i,
    // #12345 (hash followed by numbers) - explicitly marked
    /\#(\d{4,})\b/,
    // (12345) - numbers in parentheses that look like builds
    /\((\d{6,})\)/,
    // Enhanced build patterns for scene releases
    /\bbuild[\s\-\#\.]?no[\s\-\.]?(\d+)\b/i,     // Build No 12345, Build-No.12345
    /\brev[\s\-\.]?(\d{4,})\b/i,                 // Rev 12345, Rev.12345
    /\br(\d{4,})\b/i,                            // r12345
    /\brelease[\s\-\.]?(\d{4,})\b/i,             // Release 12345
    // Bracketed and delimited builds
    /\[b(\d{4,})\]/i,                            // [b12345]
    /\[build[\s\-\#\.]?(\d+)\]/i,                // [build 12345]
    /\-b(\d{4,})\-/i,                            // -b12345-
    /\_b(\d{4,})\_/i,                            // _b12345_
    // Steam build patterns
    /\bsteam[\s\-\.]?build[\s\-\.]?(\d+)\b/i,    // Steam Build 12345
    /\bdepot[\s\-\.]?(\d{6,})\b/i,               // Depot 123456
    // Date-based build patterns (but explicitly marked)
    /\bbuild[\s\-\#\.]?(\d{8})\b/i,              // build 20241007
    /\bb(\d{8})\b/i                              // b20241007
  ];

  const ambiguousBuildPatterns = [
    // Very long number sequences that look like builds (6+ digits) - could be dates
    /\b(\d{6,})\b/
  ];

  let explicitBuildResult = null;
  let ambiguousBuildResult = null;

  // First check if the title has date-based versions that might conflict
  const hasDateVersion = /\bv?\d{4}[-\.]?\d{2}[-\.]?\d{2}\b/i.test(title) || /\bv?\d{6,8}\b/i.test(title);

  // Check for explicit builds first (these are preferred)
  for (const pattern of explicitBuildPatterns) {
    const match = title.match(pattern);
    if (match) {
      const buildNum = match[1];
      
      // Additional validation for build numbers
      // Should be at least 4 digits and not look like a year
      if (buildNum.length >= 4 && !(buildNum.length === 4 && parseInt(buildNum) >= 1990 && parseInt(buildNum) <= 2030)) {
        explicitBuildResult = { found: true, build: buildNum, isDateBasedBuild: false };
        break;
      }
    }
  }

  // Check for ambiguous builds (long number sequences)
  if (!explicitBuildResult) {
    for (const pattern of ambiguousBuildPatterns) {
      const match = title.match(pattern);
      if (match) {
        const buildNum = match[1];
        
        // Additional validation for build numbers
        if (buildNum.length >= 4 && !(buildNum.length === 4 && parseInt(buildNum) >= 1990 && parseInt(buildNum) <= 2030)) {
          
          // If we have a date version, be much more strict about ambiguous builds
          if (hasDateVersion) {
            // Don't detect 8-digit numbers as builds if they could be date formats
            if (buildNum.length === 8) {
              const year = parseInt(buildNum.slice(0, 4), 10);
              const month = parseInt(buildNum.slice(4, 6), 10);
              const day = parseInt(buildNum.slice(6, 8), 10);
              if (year >= 2000 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                continue; // Skip this - it's likely a date
              }
            }
            
            // Don't detect 6-digit numbers as builds if they could be YYMMDD format
            if (buildNum.length === 6) {
              const month = parseInt(buildNum.slice(2, 4), 10);
              const day = parseInt(buildNum.slice(4, 6), 10);
              if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                continue; // Skip this - it's likely a date
              }
            }
          }
          
          // Check if this could be a date-based build
          const isDateBasedBuild = buildNum.length === 8 && /^\d{8}$/.test(buildNum);
          ambiguousBuildResult = { found: true, build: buildNum, isDateBasedBuild };
          break;
        }
      }
    }
  }

  // Return preferred build logic
  if (explicitBuildResult && ambiguousBuildResult) {
    // We have both - prefer explicit build
    return {
      ...explicitBuildResult,
      hasPreferredBuild: true
    };
  } else if (explicitBuildResult) {
    // Only explicit build
    return explicitBuildResult;
  } else if (ambiguousBuildResult) {
    // Only ambiguous build
    return ambiguousBuildResult;
  }

  return { found: false };
}

/**
 * Analyze a game title and provide intelligent suggestions
 */
export function analyzeGameTitle(title: string): VersionDetection {
  const versionDetection = detectVersionNumber(title);
  const buildDetection = detectBuildNumber(title);

  const result: VersionDetection = {
    hasVersionNumber: versionDetection.found,
    hasBuildNumber: buildDetection.found,
    detectedVersion: versionDetection.version,
    detectedBuild: buildDetection.build,
    isDateVersion: versionDetection.isDateVersion,
    isStaleDateVersion: versionDetection.isStaleDateVersion,
    dateValue: versionDetection.dateValue,
    hasPreferredVersion: versionDetection.hasPreferredVersion,
    isDateBasedBuild: buildDetection.isDateBasedBuild,
    hasPreferredBuild: buildDetection.hasPreferredBuild,
    suggestions: {
      shouldAskForBuild: false,
      shouldAskForVersion: false
    }
  };

  // Smart suggestions based on what we found
  if (versionDetection.found && !buildDetection.found) {
    // Has version, suggest build number
    result.suggestions.shouldAskForBuild = true;
    
    if (versionDetection.isDateVersion && versionDetection.isStaleDateVersion) {
      result.suggestions.message = `Detected date-based version "${versionDetection.version}" (${Math.floor((Date.now() - (versionDetection.dateValue?.getTime() || 0)) / (1000 * 60 * 60 * 24))} days old) - consider checking for newer regular version numbers or build numbers from SteamDB.`;
    } else if (versionDetection.isDateVersion) {
      result.suggestions.message = `Detected recent date-based version "${versionDetection.version}" - you can also add build numbers from SteamDB for more precise tracking.`;
    } else {
      result.suggestions.message = `Detected version "${versionDetection.version}" - you can also add the build number from SteamDB for more precise tracking.`;
    }
  } else if (buildDetection.found && !versionDetection.found) {
    // Has build, suggest version number
    result.suggestions.shouldAskForVersion = true;
    
    if (buildDetection.isDateBasedBuild) {
      result.suggestions.message = `Detected build "${buildDetection.build}" (appears to be date-based) - you can also add a regular version number for better tracking.`;
    } else {
      result.suggestions.message = `Detected build "${buildDetection.build}" - you can also add the version number for complete tracking.`;
    }
  } else if (!versionDetection.found && !buildDetection.found) {
    // Has neither, suggest both but prioritize version
    result.suggestions.shouldAskForVersion = true;
    result.suggestions.message = `No version information detected in title - you can add version numbers and/or build numbers for better update tracking.`;
  } else if (versionDetection.found && buildDetection.found) {
    // Has both
    let message = '';
    
    if (versionDetection.isDateVersion && versionDetection.isStaleDateVersion) {
      message += `Detected date-based version "${versionDetection.version}" (outdated)`;
    } else if (versionDetection.isDateVersion) {
      message += `Detected recent date-based version "${versionDetection.version}"`;
    } else {
      message += `Detected version "${versionDetection.version}"`;
    }
    
    if (buildDetection.isDateBasedBuild) {
      message += ` and date-based build "${buildDetection.build}"`;
    } else {
      message += ` and build "${buildDetection.build}"`;
    }
    
    if (versionDetection.hasPreferredVersion || buildDetection.hasPreferredBuild) {
      message += ` (preferred non-date values selected)`;
    }
    
    message += '.';
    result.suggestions.message = message;
  }

  return result;
}

/**
 * Validate version number format
 */
export function validateVersionNumber(version: string): { valid: boolean; error?: string } {
  if (!version || version.trim().length === 0) {
    return { valid: false, error: 'Version number is required' };
  }

  const trimmedVersion = version.trim();

  // Allow various version formats including date-based versions
  const validPatterns = [
    /^\d+$/, // 1
    /^\d+\.\d+$/, // 1.2
    /^\d+\.\d+\.\d+$/, // 1.2.3
    /^\d+\.\d+\.\d+\.\d+$/, // 1.2.3.4
    /^v\d+(?:\.\d+)*$/, // v1.2.3
    /^\d+(?:\.\d+)*[a-z]$/, // 1.2a
    /^\d+(?:\.\d+)*\-(?:alpha|beta|rc|final|release)$/, // 1.2-beta
    /^\d{8}$/, // 20250922 (date-based)
    /^\d{4}[-\.]\d{2}[-\.]\d{2}$/, // 2025-09-22 or 2025.09.22 (date-based)
    /^v\d{8}$/, // v20250922 (date-based with v prefix)
    /^v\d{4}[-\.]\d{2}[-\.]\d{2}$/ // v2025-09-22 or v2025.09.22
  ];

  const isValid = validPatterns.some(pattern => pattern.test(trimmedVersion));

  if (!isValid) {
    return { 
      valid: false, 
      error: 'Invalid version format. Examples: 1.2, v1.2.3, 2.0.1, 1.5a, 2.0-beta, 20250922, v20250922' 
    };
  }

  return { valid: true };
}

/**
 * Validate build number format
 */
export function validateBuildNumber(build: string): { valid: boolean; error?: string } {
  if (!build || build.trim().length === 0) {
    return { valid: false, error: 'Build number is required' };
  }

  const trimmedBuild = build.trim();

  // Should be numeric only and reasonable length
  if (!/^\d+$/.test(trimmedBuild)) {
    return { valid: false, error: 'Build number should contain only digits' };
  }

  if (trimmedBuild.length < 3) {
    return { valid: false, error: 'Build number seems too short (minimum 3 digits)' };
  }

  if (trimmedBuild.length > 12) {
    return { valid: false, error: 'Build number seems too long (maximum 12 digits)' };
  }

  return { valid: true };
}

/**
 * Clean and normalize version number
 */
export function normalizeVersionNumber(version: string): string {
  const normalized = version.trim().toLowerCase().replace(/^v/, '');
  
  // For date-based versions, ensure consistent format
  if (/^\d{4}[-\.]\d{2}[-\.]\d{2}$/.test(normalized)) {
    // Convert YYYY-MM-DD or YYYY.MM.DD to YYYYMMDD
    return normalized.replace(/[-\.]/g, '');
  }
  
  return normalized;
}

/**
 * Clean and normalize build number
 */
export function normalizeBuildNumber(build: string): string {
  return build.trim();
}

/**
 * Test function to verify version detection logic
 */
export function testVersionDetection() {
  const testCases = [
    "Game Title v1.5.2 CODEX",                    // Regular version + release group
    "Game Title v20250929 GOG",                   // Date version + release group  
    "Game Title v1.5.2 Build 12345 CODEX",       // Regular version + build + release group
    "Game Title v20250929 Build 12345 GOG",      // Date version + build + release group
    "Game Title v20250929 v1.5.2 CODEX",         // Both date and regular version
    "Game Title 20250929 PLAZA",                  // Date without v prefix
    "Game Title v1.0-alpha SKIDROW",              // Alpha version
    "Game Title v2.1b REPACK",                    // Version with letter suffix
    "Another Game v20241201 FITGIRL",             // Old date version
  ];

  console.log("🧪 Testing Version Detection Logic:");
  console.log("==================================");

  testCases.forEach((testCase, index) => {
    console.log(`\n${index + 1}. "${testCase}"`);
    const analysis = analyzeGameTitle(testCase);
    
    console.log(`   Version: ${analysis.detectedVersion || 'None'}`);
    console.log(`   Build: ${analysis.detectedBuild || 'None'}`);
    console.log(`   Is Date Version: ${analysis.isDateVersion ? 'Yes' : 'No'}`);
    console.log(`   Is Stale Date: ${analysis.isStaleDateVersion ? 'Yes' : 'No'}`);
    console.log(`   Has Preferred: ${analysis.hasPreferredVersion ? 'Yes' : 'No'}`);
    if (analysis.suggestions.message) {
      console.log(`   Suggestion: ${analysis.suggestions.message}`);
    }
  });
  
  console.log("\n==================================");
}

/**
 * Compare two version strings and return:
 * - Positive number if version1 > version2
 * - Negative number if version1 < version2
 * - 0 if versions are equal
 * 
 * Handles semantic versions (1.2.3), simple versions (1.2), and single numbers (5)
 */
export function compareVersions(version1: string, version2: string): number {
  // Normalize versions by removing 'v' prefix and converting to lowercase
  const v1 = version1.toLowerCase().replace(/^v/, '').trim();
  const v2 = version2.toLowerCase().replace(/^v/, '').trim();
  
  // Split versions by dots and convert to numbers
  const parts1 = v1.split(/[.\-_]/).map(p => {
    const num = parseInt(p, 10);
    return isNaN(num) ? 0 : num;
  });
  const parts2 = v2.split(/[.\-_]/).map(p => {
    const num = parseInt(p, 10);
    return isNaN(num) ? 0 : num;
  });
  
  // Compare each part
  const maxLength = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLength; i++) {
    const part1 = i < parts1.length ? parts1[i] : 0;
    const part2 = i < parts2.length ? parts2[i] : 0;
    
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }
  
  return 0; // Versions are equal
}

// Uncomment to run tests in development
// testVersionDetection();