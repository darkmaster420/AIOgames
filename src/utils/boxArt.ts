/**
 * Box art utilities for Steam and GOG games
 */

import logger from './logger';

/**
 * Get Steam box art URL
 * Uses library_600x900_2x.jpg for vertical box art
 */
export function getSteamBoxArt(appId: string | number): string {
  return `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900_2x.jpg`;
}

/**
 * Get GOG box art URL from GOGDB product data
 * Fetches the product.json and extracts the image_boxart hash
 */
export async function getGOGBoxArt(productId: string | number): Promise<string | null> {
  try {
    const productUrl = `https://www.gogdb.org/data/products/${productId}/product.json`;
    logger.info(`🎨 Fetching GOG box art for product ${productId} from ${productUrl}`);
    
    const response = await fetch(productUrl);
    
    if (!response.ok) {
      logger.warn(`⚠️ Failed to fetch GOG product data for ${productId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.image_boxart) {
      logger.warn(`⚠️ No box art found for GOG product ${productId}`);
      return null;
    }

    const boxArtUrl = `https://images.gog-statics.com/${data.image_boxart}.jpg`;
    logger.info(`✅ GOG box art URL generated: ${boxArtUrl}`);
    
    return boxArtUrl;
    
  } catch (error) {
    logger.error(`❌ Error fetching GOG box art for product ${productId}:`, error);
    return null;
  }
}

/**
 * Update game image with appropriate box art based on verification status
 * Priority: Existing image > Steam box art > GOG box art
 */
export async function updateGameBoxArt(
  game: { 
    image?: string; 
    steamVerified?: boolean; 
    steamAppId?: string | number;
    gogVerified?: boolean;
    gogProductId?: string | number;
  }
): Promise<string | null> {
  // If game already has an image, don't override it
  if (game.image) {
    return game.image;
  }

  // Try Steam box art first (if Steam verified)
  if (game.steamVerified && game.steamAppId) {
    const steamBoxArt = getSteamBoxArt(game.steamAppId);
    logger.info(`🎮 Using Steam box art for verified game (App ID: ${game.steamAppId})`);
    return steamBoxArt;
  }

  // Try GOG box art (if GOG verified)
  if (game.gogVerified && game.gogProductId && game.gogProductId !== -1) {
    const gogBoxArt = await getGOGBoxArt(game.gogProductId);
    if (gogBoxArt) {
      logger.info(`🎮 Using GOG box art for verified game (Product ID: ${game.gogProductId})`);
      return gogBoxArt;
    }
  }

  return null;
}
