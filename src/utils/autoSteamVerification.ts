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
 * @param confidenceThreshold - Minimum confidence threshold (default: 0.85)
 * @returns Promise<AutoVerificationResult>
 */
export async function autoVerifyWithSteam(
  gameTitle: string, 
  confidenceThreshold: number = 0.85
): Promise<AutoVerificationResult> {
  try {
    console.log(`🔍 Attempting auto Steam verification for: "${gameTitle}"`);
    
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
      console.log(`✅ Auto Steam verification successful: "${bestMatch.name}" (${bestMatch.appid}) with confidence ${bestConfidence.toFixed(2)}`);
      
      return {
        success: true,
        steamAppId: parseInt(bestMatch.appid, 10), // Convert string to number
        steamName: bestMatch.name,
        confidence: bestConfidence,
        reason: `High confidence match found (${(bestConfidence * 100).toFixed(1)}%)`
      };
    } else {
      const topMatch = searchResponse.results[0];
      console.log(`⚠️ Auto Steam verification failed: Best match "${topMatch?.name}" had confidence ${bestConfidence.toFixed(2)}, threshold is ${confidenceThreshold}`);
      
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
  
  // Boost for exact matches
  if (searchTitle.toLowerCase().trim() === steamGame.name.toLowerCase().trim()) {
    confidence = Math.max(confidence, 0.95);
  }
  
  // Check for cleaned title match
  const cleanedSearchTitle = cleanGameTitle(searchTitle);
  const cleanedSteamName = cleanGameTitle(steamGame.name);
  if (cleanedSearchTitle === cleanedSteamName) {
    confidence = Math.max(confidence, 0.90);
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
