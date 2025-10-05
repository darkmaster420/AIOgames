/**
 * AI-powered update detection utilities
 * Integrates with existing update detection system
 */

import { cleanGameTitle } from './steamApi';

export interface AIGameCandidate {
  title: string;
  similarity: number;
  sourceUrl?: string;
  dateFound?: string;
}

export interface AIDetectionResult {
  title: string;
  isUpdate: boolean;
  confidence: number;
  reason: string;
  similarity?: number;
  sourceUrl?: string;
  dateFound?: string;
}

export interface AIDetectionOptions {
  minConfidence?: number;
  maxCandidates?: number;
  requireVersionPattern?: boolean;
  debugLogging?: boolean;
}

/**
 * Use AI to detect updates from a list of candidate game titles
 * Falls back to regex detection if AI is unavailable
 */
export async function detectUpdatesWithAI(
  gameTitle: string,
  candidates: AIGameCandidate[],
  context?: {
    lastKnownVersion?: string;
    releaseGroup?: string;
    gameLink?: string;
  },
  options: AIDetectionOptions = {}
): Promise<AIDetectionResult[]> {
  const {
    minConfidence = 0.7,
    maxCandidates = 20,
    requireVersionPattern = true,
    debugLogging = false
  } = options;

  if (debugLogging) {
    console.log(`🤖 AI update detection for "${gameTitle}" with ${candidates.length} candidates`);
  }

  // Filter and limit candidates
  let filteredCandidates = [...candidates];

  // If requireVersionPattern is true, filter candidates that have version/build patterns
  if (requireVersionPattern) {
    const { detectVersionNumber } = await import('./versionDetection');
    
    filteredCandidates = filteredCandidates.filter(candidate => {
      const { found: hasVersion } = detectVersionNumber(candidate.title);
      const hasBuild = /\b(build|b|#)\s*\d{3,}\b/i.test(candidate.title);
      return hasVersion || hasBuild;
    });

    if (debugLogging) {
      console.log(`🔍 Filtered to ${filteredCandidates.length} candidates with version/build patterns`);
    }
  }

  // Limit number of candidates to avoid overwhelming the AI
  if (filteredCandidates.length > maxCandidates) {
    // Sort by similarity and take top candidates
    filteredCandidates.sort((a, b) => b.similarity - a.similarity);
    filteredCandidates = filteredCandidates.slice(0, maxCandidates);
    
    if (debugLogging) {
      console.log(`📊 Limited to top ${maxCandidates} candidates by similarity`);
    }
  }

  if (filteredCandidates.length === 0) {
    if (debugLogging) {
      console.log('⚠️ No candidates remaining after filtering');
    }
    return [];
  }

  try {
    // Call AI detection API directly (external worker)
    const workerUrl = process.env.AI_DETECTION_WORKER_URL;
    if (!workerUrl) {
      if (debugLogging) {
        console.log('⚠️ AI worker URL not configured, falling back to regex');
      }
      return fallbackToRegexDetection(gameTitle, filteredCandidates, context, options);
    }

    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        gameTitle,
        candidateTitles: filteredCandidates,
        context
      })
    });

    if (!response.ok) {
      if (debugLogging) {
        console.log(`⚠️ AI detection API failed: ${response.status}, falling back to regex`);
      }
      return fallbackToRegexDetection(gameTitle, filteredCandidates, context, options);
    }

    const result = await response.json();

    if (!result.success || !Array.isArray(result.analysis)) {
      if (debugLogging) {
        console.log('⚠️ Invalid AI response, falling back to regex');
      }
      return fallbackToRegexDetection(gameTitle, filteredCandidates, context, options);
    }

    // Filter results by confidence
    const validResults = result.analysis
      .filter((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false;
        const obj = item as Record<string, unknown>;
        return typeof obj.confidence === 'number' && obj.confidence >= minConfidence;
      })
      .map((item: Record<string, unknown>) => ({
        title: String(item.title || ''),
        isUpdate: Boolean(item.isUpdate),
        confidence: Number(item.confidence || 0),
        reason: String(item.reason || ''),
        similarity: Number(item.similarity || 0),
        sourceUrl: item.sourceUrl ? String(item.sourceUrl) : undefined,
        dateFound: item.dateFound ? String(item.dateFound) : undefined
      }));

    if (debugLogging) {
      const updates = validResults.filter((r: AIDetectionResult) => r.isUpdate);
      console.log(`✅ AI detection completed: ${updates.length} updates found (confidence >= ${minConfidence})`);
    }

    return validResults;

  } catch (error) {
    if (debugLogging) {
      console.log(`❌ AI detection error: ${error}, falling back to regex`);
    }
    return fallbackToRegexDetection(gameTitle, filteredCandidates, context, options);
  }
}

/**
 * Fallback regex-based update detection when AI is unavailable
 */
async function fallbackToRegexDetection(
  gameTitle: string,
  candidates: AIGameCandidate[],
  context?: {
    lastKnownVersion?: string;
    releaseGroup?: string;
    gameLink?: string;
  },
  options: AIDetectionOptions = {}
): Promise<AIDetectionResult[]> {
  const { debugLogging = false } = options;
  
  if (debugLogging) {
    console.log('🔄 Using fallback regex detection');
  }

  const results: AIDetectionResult[] = [];

  // Import version detection utilities
  const { detectVersionNumber, detectBuildNumber } = await import('./versionDetection');

  for (const candidate of candidates) {
    try {
      // Skip if same as current game link
      if (context?.gameLink && candidate.sourceUrl === context.gameLink) {
        continue;
      }

      // Check version/build patterns
      const candidateVersion = detectVersionNumber(candidate.title);
      const candidateBuild = detectBuildNumber(candidate.title);

      // Basic update detection logic
      let isUpdate = false;
      let confidence = 0.5; // Lower confidence for regex fallback
      let reason = 'Regex pattern analysis';

      // If we have a last known version, compare
      if (context?.lastKnownVersion && candidateVersion.found) {
        const currentVersion = detectVersionNumber(context.lastKnownVersion);
        
        if (currentVersion.found) {
          // Simple version comparison (this could be enhanced)
          if (candidateVersion.version !== currentVersion.version) {
            isUpdate = true;
            confidence = 0.8;
            reason = `Version change detected: ${currentVersion.version} → ${candidateVersion.version}`;
          }
        }
      }

      // If we have build numbers, compare those
      if (candidateBuild.found && context?.lastKnownVersion) {
        const currentBuild = detectBuildNumber(context.lastKnownVersion);
        
        if (currentBuild.found && candidateBuild.build !== currentBuild.build) {
          isUpdate = true;
          confidence = Math.max(confidence, 0.7);
          reason = `Build number change: ${currentBuild.build} → ${candidateBuild.build}`;
        }
      }

      // Check for update keywords
      const updateKeywords = [
        'update', 'patch', 'hotfix', 'build', 'version', 'v\\d', 
        'fixed', 'bugfix', 'new version', 'latest'
      ];
      
      const hasUpdateKeywords = updateKeywords.some(keyword => 
        new RegExp(keyword, 'i').test(candidate.title)
      );

      if (hasUpdateKeywords && candidate.similarity > 0.8) {
        isUpdate = true;
        confidence = Math.max(confidence, 0.6);
        reason = 'Update keywords detected with high similarity';
      }

      results.push({
        title: candidate.title,
        isUpdate,
        confidence,
        reason,
        similarity: candidate.similarity,
        sourceUrl: candidate.sourceUrl,
        dateFound: candidate.dateFound
      });

    } catch {
      if (debugLogging) {
        console.log(`❌ Error processing candidate "${candidate.title}"`);
      }
    }
  }

  if (debugLogging) {
    const updates = results.filter(r => r.isUpdate);
    console.log(`🔄 Regex fallback completed: ${updates.length} potential updates found`);
  }

  return results;
}

/**
 * Check if AI detection service is available
 */
export async function isAIDetectionAvailable(): Promise<boolean> {
  try {
    const workerUrl = process.env.AI_DETECTION_WORKER_URL;
    if (!workerUrl) {
      return false;
    }

    const response = await fetch(`${workerUrl.replace('/ai', '')}/ai/health`, {
      method: 'GET'
    });

    return response.ok;
    
  } catch {
    return false;
  }
}

/**
 * Prepare candidates from search results for AI analysis
 */
export function prepareCandidatesForAI(
  searchResults: Array<Record<string, unknown>>,
  gameTitle: string,
  options: {
    maxCandidates?: number;
    minSimilarity?: number;
    includeDate?: boolean;
  } = {}
): AIGameCandidate[] {
  const {
    maxCandidates = 20,
    minSimilarity = 0.3,
    includeDate = true
  } = options;

  const cleanTitle = cleanGameTitle(gameTitle);
  
  // Calculate similarity and prepare candidates
  const candidates: AIGameCandidate[] = searchResults
    .map(result => {
      const title = String(result.title || '');
      const cleanResultTitle = cleanGameTitle(title);
      const similarity = calculateStringSimilarity(cleanTitle, cleanResultTitle);
      
      return {
        title,
        similarity,
        sourceUrl: result.link ? String(result.link) : (result.url ? String(result.url) : undefined),
        dateFound: includeDate ? (result.date ? String(result.date) : (result.dateFound ? String(result.dateFound) : undefined)) : undefined
      };
    })
    .filter(candidate => 
      candidate.title.length > 0 && 
      candidate.similarity >= minSimilarity
    )
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxCandidates);

  return candidates;
}

/**
 * Simple string similarity calculation (Dice coefficient)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (str1.length < 2 || str2.length < 2) return 0;

  const bigrams1 = new Set<string>();
  const bigrams2 = new Set<string>();

  for (let i = 0; i < str1.length - 1; i++) {
    bigrams1.add(str1.substr(i, 2));
  }

  for (let i = 0; i < str2.length - 1; i++) {
    bigrams2.add(str2.substr(i, 2));
  }

  const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
  return (2 * intersection.size) / (bigrams1.size + bigrams2.size);
}

const aiUpdateDetectionUtils = {
  detectUpdatesWithAI,
  isAIDetectionAvailable,
  prepareCandidatesForAI
};

export default aiUpdateDetectionUtils;