import { searchSteamGames, calculateGameSimilarity, cleanGameTitle } from './steamApi';

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
  try {
    // Attempting auto Steam verification
    
    // Search Steam API with the game title
    const searchResponse = await searchSteamGames(gameTitle, 5);
    
    if (!searchResponse.results || searchResponse.results.length === 0) {
      return {
        success: false,
        confidence: 0,
        reason: 'No Steam results found'
      };
    }
    
    // Find the best match
    let bestMatch: SteamGameResult | null = null;
    let bestConfidence = 0;
    
    for (const result of searchResponse.results) {
      // Skip error messages or invalid results
      if (!result.appid || result.name.includes('No games found')) {
        continue;
      }
      
      // Only consider actual games, not DLC or demos (if type is provided)
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
      // Auto Steam verification successful
      
      return {
        success: true,
        steamAppId: parseInt(bestMatch.appid, 10), // Convert string to number
        steamName: bestMatch.name,
        confidence: bestConfidence,
        reason: `High confidence match found (${(bestConfidence * 100).toFixed(1)}%)`
      };
    } else {
      // Auto Steam verification failed - confidence below threshold
      
      return {
        success: false,
        confidence: bestConfidence,
        reason: `Best match confidence (${(bestConfidence * 100).toFixed(1)}%) below threshold (${(confidenceThreshold * 100).toFixed(1)}%)`
      };
    }
    
  } catch (error) {
    console.error(`❌ Auto Steam verification error for "${gameTitle}":`, error);
    
    return {
      success: false,
      confidence: 0,
      reason: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Calculate confidence score for Steam game match
 * Enhanced version that considers multiple factors
 */
function calculateConfidence(searchTitle: string, steamGame: SteamGameResult): number {
  // Base similarity calculation
  const similarity = calculateGameSimilarity(searchTitle, steamGame.name);
  let confidence = similarity;
  
  // Enhanced normalization for better matching
  const normalize = (str: string) => {
    return str
      .toLowerCase()
      .replace(/[']/g, '')           // Remove apostrophes: "Marvel's" -> "Marvels"
      .replace(/[-:]/g, ' ')         // Convert dashes/colons to spaces: "Spider-Man" -> "Spider Man"
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim();
  };
  
  const normSearchTitle = normalize(searchTitle);
  const normSteamName = normalize(steamGame.name);
  
  // Boost for exact matches after normalization
  if (normSearchTitle === normSteamName) {
    confidence = Math.max(confidence, 0.95);
  }
  
  // Check for cleaned title match
  const cleanedSearchTitle = cleanGameTitle(searchTitle);
  const cleanedSteamName = cleanGameTitle(steamGame.name);
  if (cleanedSearchTitle === cleanedSteamName) {
    confidence = Math.max(confidence, 0.90);
  }
  
  // Special handling for common title variations
  const searchWords = normSearchTitle.split(/\s+/);
  const steamWords = normSteamName.split(/\s+/);
  
  // Handle possessive variations (Marvel's vs Marvels)
  if (searchWords.length === steamWords.length) {
    let possessiveMatch = true;
    for (let i = 0; i < searchWords.length; i++) {
      const word1 = searchWords[i];
      const word2 = steamWords[i];
      
      // Check if words match exactly or are possessive variants
      if (word1 !== word2) {
        if (!((word1 === 'marvels' && word2 === 'marvel') || 
              (word1 === 'marvel' && word2 === 'marvels') ||
              (word1.endsWith('s') && word1.slice(0, -1) === word2) ||
              (word2.endsWith('s') && word2.slice(0, -1) === word1))) {
          possessiveMatch = false;
          break;
        }
      }
    }
    
    if (possessiveMatch) {
      confidence = Math.max(confidence, 0.92);
    }
  }
  
  // Boost for games with good metadata (indicates it's a real, well-documented game)
  if (steamGame.developers && steamGame.developers.length > 0) {
    confidence += 0.05;
  }
  
  // Boost for popular/well-rated games
  if (steamGame.userscore && steamGame.userscore > 75) {
    confidence += 0.03;
  }
  
  if (steamGame.positive && steamGame.positive > 1000) {
    confidence += 0.02;
  }
  
  // Slight boost for highly ranked games
  if (steamGame.score_rank) {
    const rank = parseInt(steamGame.score_rank);
    if (rank <= 100) {
      confidence += 0.02;
    } else if (rank <= 1000) {
      confidence += 0.01;
    }
  }
  
  return Math.min(confidence, 1.0); // Cap at 1.0
}
