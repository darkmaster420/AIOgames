import {
  searchSteamGames,
  calculateGameSimilarity,
  cleanGameTitle,
  buildSteamSearchQueryVariants,
  isRetryableSteamTransportError
} from './steamApi';

// Use the same interface as steamApi.ts for consistency
interface SteamGameResult {
  appid: string; // Keep as string to match steamApi.ts
  name: string;
  type: 'game' | 'dlc' | 'demo' | 'beta' | 'tool';
  developers?: string[];
  publishers?: string[];
  userscore?: number;
  positive?: number;
  negative?: number;
  score_rank?: string;
}

interface AutoVerificationResult {
  success: boolean;
  steamAppId?: number; // Convert to number for database storage
  steamName?: string;
  confidence: number;
  reason: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAutoVerifyCore(
  gameTitle: string,
  confidenceThreshold: number
): Promise<AutoVerificationResult> {
  const queryVariants = buildSteamSearchQueryVariants(gameTitle);
  const mergedResults: SteamGameResult[] = [];
  const seenAppIds = new Set<string>();

  for (const query of queryVariants) {
    const searchResponse = await searchSteamGames(query, 5);
    if (!searchResponse.results || searchResponse.results.length === 0) {
      continue;
    }

    for (const result of searchResponse.results) {
      if (!result.appid || seenAppIds.has(result.appid)) continue;
      seenAppIds.add(result.appid);
      mergedResults.push(result);
    }
  }

  if (mergedResults.length === 0) {
    return {
      success: false,
      confidence: 0,
      reason: 'No Steam results found'
    };
  }

  let bestMatch: SteamGameResult | null = null;
  let bestConfidence = 0;

  for (const result of mergedResults) {
    if (!result.appid || result.name.includes('No games found')) {
      continue;
    }

    if (result.type && !['game', 'app'].includes(result.type)) {
      continue;
    }

    const confidence = calculateConfidence(gameTitle, result);

    if (confidence > bestConfidence && confidence >= confidenceThreshold) {
      bestMatch = result;
      bestConfidence = confidence;
    }
  }

  if (bestMatch && bestConfidence >= confidenceThreshold) {
    return {
      success: true,
      steamAppId: parseInt(bestMatch.appid, 10),
      steamName: bestMatch.name,
      confidence: bestConfidence,
      reason: `High confidence match found (${(bestConfidence * 100).toFixed(1)}%)`
    };
  }

  return {
    success: false,
    confidence: bestConfidence,
    reason: `Best match confidence (${(bestConfidence * 100).toFixed(1)}%) below threshold (${(confidenceThreshold * 100).toFixed(1)}%)`
  };
}

/**
 * Automatically attempt Steam verification for a game
 * @param gameTitle - The title of the game to verify
 * @param confidenceThreshold - Minimum confidence threshold (default: 0.80)
 * @returns Promise<AutoVerificationResult>
 */
export async function autoVerifyWithSteam(
  gameTitle: string,
  confidenceThreshold: number = 0.80
): Promise<AutoVerificationResult> {
  const maxTransportAttempts = 3;

  for (let attempt = 1; attempt <= maxTransportAttempts; attempt++) {
    try {
      return await runAutoVerifyCore(gameTitle, confidenceThreshold);
    } catch (error) {
      const retryable =
        attempt < maxTransportAttempts && isRetryableSteamTransportError(error);
      if (retryable) {
        console.warn(
          `Auto Steam verify transport retry ${attempt}/${maxTransportAttempts} for "${gameTitle}":`,
          error
        );
        await sleep(650 * attempt);
        continue;
      }
      console.error(`Auto Steam verification error for "${gameTitle}":`, error);
      return {
        success: false,
        confidence: 0,
        reason: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  return {
    success: false,
    confidence: 0,
    reason: 'Steam verification failed after retries'
  };
}

/**
 * Multi-step Steam auto-verify for add-tracking: raw title, cleaned title, then lower thresholds.
 * Avoids the old bug where retry was skipped when cleaned string matched `title.toLowerCase().trim()`.
 */
export async function autoVerifyWithSteamLadderForTrack(
  titleFromUser: string,
  clientCleanedTitle?: string
): Promise<AutoVerificationResult> {
  const primary = (titleFromUser || '').trim();
  if (!primary) {
    return { success: false, confidence: 0, reason: 'Empty title' };
  }
  const cleaned = cleanGameTitle(primary);

  const stages: Array<{ query: string; threshold: number }> = [
    { query: primary, threshold: 0.85 },
    { query: cleaned, threshold: 0.8 },
    { query: cleaned, threshold: 0.72 },
    { query: cleaned, threshold: 0.65 },
  ];

  const cc = (clientCleanedTitle || '').trim();
  if (cc) {
    const ccNorm = cleanGameTitle(cc);
    if (ccNorm && ccNorm !== cleaned) {
      stages.push({ query: ccNorm, threshold: 0.72 });
    }
  }

  let last: AutoVerificationResult = {
    success: false,
    confidence: 0,
    reason: 'No match',
  };
  const tried = new Set<string>();

  for (const { query, threshold } of stages) {
    if (!query) continue;
    const key = `${query}\0${threshold}`;
    if (tried.has(key)) continue;
    tried.add(key);
    last = await autoVerifyWithSteam(query, threshold);
    if (last.success) return last;
  }
  return last;
}

/**
 * Calculate confidence score for Steam game match
 * Enhanced version that considers multiple factors
 */
function calculateConfidence(searchTitle: string, steamGame: SteamGameResult): number {
  const similarity = calculateGameSimilarity(searchTitle, steamGame.name);
  let confidence = similarity;

  const normalize = (str: string) => {
    return str
      .toLowerCase()
      .replace(/[\u2018\u2019\u2032'"`]/g, '')
      .replace(/[-:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const normSearchTitle = normalize(searchTitle);
  const normSteamName = normalize(steamGame.name);

  if (normSearchTitle === normSteamName) {
    confidence = Math.max(confidence, 0.95);
  }

  const cleanedSearchTitle = cleanGameTitle(searchTitle);
  const cleanedSteamName = cleanGameTitle(steamGame.name);
  if (cleanedSearchTitle === cleanedSteamName) {
    confidence = Math.max(confidence, 0.90);
  }

  const searchWords = normSearchTitle.split(/\s+/);
  const steamWords = normSteamName.split(/\s+/);

  if (searchWords.length === steamWords.length) {
    let possessiveMatch = true;
    for (let i = 0; i < searchWords.length; i++) {
      const word1 = searchWords[i];
      const word2 = steamWords[i];

      if (word1 !== word2) {
        if (
          !(
            (word1 === 'marvels' && word2 === 'marvel') ||
            (word1 === 'marvel' && word2 === 'marvels') ||
            (word1.endsWith('s') && word1.slice(0, -1) === word2) ||
            (word2.endsWith('s') && word2.slice(0, -1) === word1)
          )
        ) {
          possessiveMatch = false;
          break;
        }
      }
    }

    if (possessiveMatch) {
      confidence = Math.max(confidence, 0.92);
    }
  }

  if (steamGame.developers && steamGame.developers.length > 0) {
    confidence += 0.05;
  }

  if (steamGame.userscore && steamGame.userscore > 75) {
    confidence += 0.03;
  }

  if (steamGame.positive && steamGame.positive > 1000) {
    confidence += 0.02;
  }

  if (steamGame.score_rank) {
    const rank = parseInt(steamGame.score_rank);
    if (rank <= 100) {
      confidence += 0.02;
    } else if (rank <= 1000) {
      confidence += 0.01;
    }
  }

  return Math.min(confidence, 1.0);
}
