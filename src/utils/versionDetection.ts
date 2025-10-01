/**
 * Extract release group from game title
 */
export function extractReleaseGroup(title: string): { releaseGroup: string; cleanTitle: string } {
  const releaseGroupPatterns = [
    // Common release groups (case insensitive)
    /[-\s]*(GOG|P2P|CODEX|SKIDROW|REPACK|FITGIRL|DODI|EMPRESS|RUNE|PLAZA|HOODLUM|RAZOR1911|STEAMPUNKS|DARKSiDERS|GOLDBERG|ALI213|3DM|PROPHET|CPY|SCENE|CRACKED|FULL|UNLOCKED)[-\s]*$/i,
    // Version with release group like v1.0-GOG
    /[-\s]+(GOG|P2P|CODEX|SKIDROW|REPACK|FITGIRL|DODI|EMPRESS|RUNE|PLAZA|HOODLUM|RAZOR1911|STEAMPUNKS|DARKSiDERS|GOLDBERG|ALI213|3DM|PROPHET|CPY|SCENE|CRACKED|FULL|UNLOCKED)$/i
  ];

  for (const pattern of releaseGroupPatterns) {
    const match = title.match(pattern);
    if (match) {
      const releaseGroup = match[1].toUpperCase();
      const cleanTitle = title.replace(pattern, '').trim();
      return { releaseGroup, cleanTitle };
    }
  }

  // Default to source-based classification if no explicit release group
  if (title.toLowerCase().includes('gog')) {
    return { releaseGroup: 'GOG', cleanTitle: title.replace(/[-\s]*gog[-\s]*/i, '').trim() };
  }
  if (title.toLowerCase().includes('p2p')) {
    return { releaseGroup: 'P2P', cleanTitle: title.replace(/[-\s]*p2p[-\s]*/i, '').trim() };
  }

  return { releaseGroup: 'UNKNOWN', cleanTitle: title };
}

/**
 * Utility functions for detecting and parsing version and build numbers from game titles
 */

export interface VersionDetection {
  hasVersionNumber: boolean;
  hasBuildNumber: boolean;
  detectedVersion?: string;
  detectedBuild?: string;
  suggestions: {
    shouldAskForBuild: boolean;
    shouldAskForVersion: boolean;
    message?: string;
  };
}

/**
 * Detect version numbers in title (e.g., v1.2.3, 1.0, 2.5.1, etc.)
 */

export function detectVersionNumber(title: string): { found: boolean; version?: string; isDateVersion?: boolean; isStaleDateVersion?: boolean; dateValue?: Date } {
  const versionPatterns = [
    // Date-based versions like v20250922, v2025.09.22, v27.08.25, v270825 (prioritize these)
    /\bv(\d{4})[-\.]?(\d{2})[-\.]?(\d{2})\b/i, // vYYYYMMDD or vYYYY.MM.DD or vYYYY-MM-DD
    /\bv(\d{8})\b/i, // vYYYYMMDD
    /\bv(\d{2})[-\.]?(\d{2})[-\.]?(\d{2})\b/i, // vYY.MM.DD or vYYMMDD
    /\bv(\d{6})\b/i, // vYYMMDD
    // Special patterns like v1.0a, v2.1b, v1.5-beta, v1.0alpha (check these BEFORE simple patterns)
    /\bv(\d+(?:\.\d+)*(?:[a-z]|(?:\-?(?:alpha|beta|rc|final|release))))\b/i,
    // v1.2.3, v1.2, v1.0.0 (simple numeric patterns)
    /\bv(\d+(?:\.\d+){0,3})\b/i,
    // Version 1.2.3, Ver 1.2
    /\b(?:version|ver)[\s\-\.]?(\d+(?:\.\d+){0,3})\b/i,
    // 1.2.3 (standalone version numbers)
    /\b(\d+\.\d+(?:\.\d+)*)\b/
  ];

  // vYYYYMMDD or vYYYY.MM.DD or vYYYY-MM-DD
  let match = title.match(/\bv(\d{4})[-\.]?(\d{2})[-\.]?(\d{2})\b/i);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const dateValue = new Date(year, month, day);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
    return {
      found: true,
      version: match[0],
      isDateVersion: true,
      isStaleDateVersion: diffDays > 7,
      dateValue
    };
  }
  // vYYYYMMDD
  match = title.match(/\bv(\d{8})\b/i);
  if (match) {
    const year = parseInt(match[1].slice(0, 4), 10);
    const month = parseInt(match[1].slice(4, 6), 10) - 1;
    const day = parseInt(match[1].slice(6, 8), 10);
    const dateValue = new Date(year, month, day);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
    return {
      found: true,
      version: match[0],
      isDateVersion: true,
      isStaleDateVersion: diffDays > 7,
      dateValue
    };
  }
  // vYY.MM.DD or vYYMMDD
  match = title.match(/\bv(\d{2})[-\.]?(\d{2})[-\.]?(\d{2})\b/i);
  if (match) {
    let year = parseInt(match[1], 10);
    year += year < 50 ? 2000 : 1900; // assume 2000+ for 00-49, 1900+ for 50-99
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const dateValue = new Date(year, month, day);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
    return {
      found: true,
      version: match[0],
      isDateVersion: true,
      isStaleDateVersion: diffDays > 7,
      dateValue
    };
  }
  // vYYMMDD
  match = title.match(/\bv(\d{6})\b/i);
  if (match) {
    let year = parseInt(match[1].slice(0, 2), 10);
    year += year < 50 ? 2000 : 1900;
    const month = parseInt(match[1].slice(2, 4), 10) - 1;
    const day = parseInt(match[1].slice(4, 6), 10);
    const dateValue = new Date(year, month, day);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
    return {
      found: true,
      version: match[0],
      isDateVersion: true,
      isStaleDateVersion: diffDays > 7,
      dateValue
    };
  }

  // Fallback to other version patterns
  for (const pattern of versionPatterns.slice(2)) {
    const match = title.match(pattern);
    if (match) {
      return { found: true, version: match[1], isDateVersion: false };
    }
  }

  return { found: false };
}

/**
 * Detect build numbers in title (e.g., Build 12345, b12345, #12345)
 */
export function detectBuildNumber(title: string): { found: boolean; build?: string } {
  const buildPatterns = [
    // Build 12345, Build#12345
    /\bbuild[\s\-\#]?(\d+)\b/i,
    // b12345, B12345
    /\bb(\d{4,})\b/i,
    // #12345 (hash followed by numbers)
    /\#(\d{4,})\b/,
    // (12345) - numbers in parentheses that look like builds
    /\((\d{6,})\)/,
    // Very long number sequences that look like builds (6+ digits)
    /\b(\d{6,})\b/
  ];

  for (const pattern of buildPatterns) {
    const match = title.match(pattern);
    if (match) {
      // Additional validation for build numbers
      const buildNum = match[1];
      // Should be at least 4 digits and not look like a year
      if (buildNum.length >= 4 && !(buildNum.length === 4 && parseInt(buildNum) >= 1990 && parseInt(buildNum) <= 2030)) {
        return { found: true, build: buildNum };
      }
    }
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
    suggestions: {
      shouldAskForBuild: false,
      shouldAskForVersion: false
    }
  };

  // Smart suggestions based on what we found
  if (versionDetection.found && !buildDetection.found) {
    // Has version, suggest build number
    result.suggestions.shouldAskForBuild = true;
    result.suggestions.message = `Detected version "${versionDetection.version}" - you can also add the build number from SteamDB for more precise tracking.`;
  } else if (buildDetection.found && !versionDetection.found) {
    // Has build, suggest version number
    result.suggestions.shouldAskForVersion = true;
    result.suggestions.message = `Detected build "${buildDetection.build}" - you can also add the version number for complete tracking.`;
  } else if (!versionDetection.found && !buildDetection.found) {
    // Has neither, suggest both but prioritize version
    result.suggestions.shouldAskForVersion = true;
    result.suggestions.message = `No version information detected in title - you can add version numbers and/or build numbers for better update tracking.`;
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