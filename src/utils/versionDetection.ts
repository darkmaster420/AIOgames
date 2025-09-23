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
export function detectVersionNumber(title: string): { found: boolean; version?: string } {
  const versionPatterns = [
    // v1.2.3, v1.2, v1.0.0
    /\bv(\d+(?:\.\d+){0,3})\b/i,
    // Version 1.2.3, Ver 1.2
    /\b(?:version|ver)[\s\-\.]?(\d+(?:\.\d+){0,3})\b/i,
    // 1.2.3 (standalone version numbers)
    /\b(\d+\.\d+(?:\.\d+)*)\b/,
    // Special patterns like v1.0a, v2.1b, v1.5-beta
    /\bv?(\d+(?:\.\d+){0,2}[a-z]?(?:\-(?:alpha|beta|rc|final|release))?)\b/i
  ];

  for (const pattern of versionPatterns) {
    const match = title.match(pattern);
    if (match) {
      return { found: true, version: match[1] };
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

  // Allow various version formats
  const validPatterns = [
    /^\d+$/, // 1
    /^\d+\.\d+$/, // 1.2
    /^\d+\.\d+\.\d+$/, // 1.2.3
    /^\d+\.\d+\.\d+\.\d+$/, // 1.2.3.4
    /^v\d+(?:\.\d+)*$/, // v1.2.3
    /^\d+(?:\.\d+)*[a-z]$/, // 1.2a
    /^\d+(?:\.\d+)*\-(?:alpha|beta|rc|final|release)$/ // 1.2-beta
  ];

  const isValid = validPatterns.some(pattern => pattern.test(trimmedVersion));

  if (!isValid) {
    return { 
      valid: false, 
      error: 'Invalid version format. Examples: 1.2, v1.2.3, 2.0.1, 1.5a, 2.0-beta' 
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
  return version.trim().toLowerCase().replace(/^v/, '');
}

/**
 * Clean and normalize build number
 */
export function normalizeBuildNumber(build: string): string {
  return build.trim();
}