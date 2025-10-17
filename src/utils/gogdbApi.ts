/**
 * GOGDB API Integration
 * Documentation: https://gogdb.org/data
 * 
 * GOGDB uses plain JSON files (sometimes gzipped) to store data.
 * Data is exposed at /data endpoint using plain HTTP.
 * Uses SQLite index for faster load times.
 */

import logger from './logger';

const GOGDB_BASE_URL = 'https://gogdb.org';
const GOGDB_DATA_URL = `${GOGDB_BASE_URL}/data`;

export interface GOGDBProduct {
  id: number;
  slug: string;
  title: string;
  type: string; // 'game', 'dlc', 'pack'
  releases: GOGDBRelease[];
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  description?: string;
  image?: string;
  is_available?: boolean;
  is_coming_soon?: boolean;
  release_date?: string;
  globalReleaseDate?: string;
}

export interface GOGDBRelease {
  platform: string; // 'windows', 'mac', 'linux'
  date?: string;
  version?: string;
  build_id?: string;
  generation?: number;
  name?: string;
}

export interface GOGDBBuild {
  product_id: number;
  build_id: string;
  version?: string;
  generation?: number;
  date_published?: string;
  os: string;
  items?: Array<{
    name: string;
    type: string;
    size: number;
  }>;
}

export interface GOGDBSearchResult {
  id: number;
  title: string;
  slug: string;
  type: string;
  image?: string;
  releaseDate?: string;
}

/**
 * Calculate similarity score between two game titles for GOG matching
 * More strict than simple includes() - requires significant word overlap
 */
function calculateGOGTitleSimilarity(query: string, title: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2); // Ignore short words
  const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (queryWords.length === 0 || titleWords.length === 0) return 0;
  
  // Exact match
  if (query.toLowerCase() === title.toLowerCase()) return 1.0;
  
  // Check how many query words are in the title
  const matchingWords = queryWords.filter(qw => 
    titleWords.some(tw => tw.includes(qw) || qw.includes(tw))
  );
  
  // Require at least 70% of query words to match
  const matchRatio = matchingWords.length / queryWords.length;
  
  // Bonus for complete match of all query words
  if (matchRatio === 1.0) return 0.95;
  
  // Bonus for word order preservation
  let orderBonus = 0;
  if (matchingWords.length >= 2) {
    const querySequence = matchingWords.join(' ');
    if (title.toLowerCase().includes(querySequence)) {
      orderBonus = 0.1;
    }
  }
  
  return matchRatio + orderBonus;
}

/**
 * Search for games on GOGDB with stricter matching
 */
export async function searchGOGDB(query: string): Promise<GOGDBSearchResult[]> {
  try {
    logger.info(`🔍 Searching GOGDB for: "${query}"`);
    
    // GOGDB doesn't have a direct search API, so we'll need to use the products index
    // For now, we'll fetch the products list and filter locally
    // In production, consider caching this or using a more efficient method
    
    const response = await fetch(`${GOGDB_DATA_URL}/products.json`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AIOgames/1.2.9 (Game Update Tracker)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`GOGDB API error: ${response.status} ${response.statusText}`);
    }
    
    const products: GOGDBProduct[] = await response.json();
    
    // Calculate similarity scores and filter with stricter threshold
    const MIN_SIMILARITY = 0.7; // Require 70% word match
    const scoredResults = products
      .map(p => ({
        product: p,
        score: Math.max(
          calculateGOGTitleSimilarity(query, p.title),
          calculateGOGTitleSimilarity(query, p.slug.replace(/-/g, ' '))
        )
      }))
      .filter(r => r.score >= MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .slice(0, 10) // Limit to 10 results
      .map(r => ({
        id: r.product.id,
        title: r.product.title,
        slug: r.product.slug,
        type: r.product.type,
        image: r.product.image,
        releaseDate: r.product.release_date || r.product.globalReleaseDate
      }));
    
    logger.info(`✅ Found ${scoredResults.length} GOGDB results for "${query}" (min similarity: ${MIN_SIMILARITY})`);
    return scoredResults;
    
  } catch (error) {
    logger.error('❌ GOGDB search failed:', error);
    return [];
  }
}

/**
 * Get detailed product information from GOGDB
 */
export async function getGOGDBProduct(productId: number): Promise<GOGDBProduct | null> {
  try {
    logger.info(`📦 Fetching GOGDB product: ${productId}`);
    
    const response = await fetch(`${GOGDB_DATA_URL}/products/${productId}.json`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AIOgames/1.2.9 (Game Update Tracker)'
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`⚠️ GOGDB product not found: ${productId}`);
        return null;
      }
      throw new Error(`GOGDB API error: ${response.status} ${response.statusText}`);
    }
    
    const product: GOGDBProduct = await response.json();
    logger.info(`✅ Retrieved GOGDB product: ${product.title}`);
    
    return product;
    
  } catch (error) {
    logger.error(`❌ Failed to fetch GOGDB product ${productId}:`, error);
    return null;
  }
}

/**
 * Get build information for a product
 */
export async function getGOGDBBuilds(productId: number, os: 'windows' | 'mac' | 'linux' = 'windows'): Promise<GOGDBBuild[]> {
  try {
    logger.info(`🔨 Fetching GOGDB builds for product ${productId} (${os})`);
    
    const response = await fetch(`${GOGDB_DATA_URL}/builds/${productId}.json`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AIOgames/1.2.9 (Game Update Tracker)'
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`⚠️ GOGDB builds not found for product: ${productId}`);
        return [];
      }
      throw new Error(`GOGDB API error: ${response.status} ${response.statusText}`);
    }
    
    const builds: GOGDBBuild[] = await response.json();
    
    // Filter by OS
    const filteredBuilds = builds.filter(b => b.os.toLowerCase() === os.toLowerCase());
    
    logger.info(`✅ Retrieved ${filteredBuilds.length} GOGDB builds for ${os}`);
    return filteredBuilds;
    
  } catch (error) {
    logger.error(`❌ Failed to fetch GOGDB builds for product ${productId}:`, error);
    return [];
  }
}

/**
 * Get the latest version for a product
 */
export async function getGOGDBLatestVersion(productId: number, os: 'windows' | 'mac' | 'linux' = 'windows'): Promise<{ version?: string; buildId?: string; date?: string } | null> {
  try {
    const builds = await getGOGDBBuilds(productId, os);
    
    if (builds.length === 0) {
      return null;
    }
    
    // Sort by date (most recent first)
    const sortedBuilds = builds.sort((a, b) => {
      const dateA = a.date_published ? new Date(a.date_published).getTime() : 0;
      const dateB = b.date_published ? new Date(b.date_published).getTime() : 0;
      return dateB - dateA;
    });
    
    const latestBuild = sortedBuilds[0];
    
    return {
      version: latestBuild.version,
      buildId: latestBuild.build_id,
      date: latestBuild.date_published
    };
    
  } catch (error) {
    logger.error(`❌ Failed to get latest GOGDB version for product ${productId}:`, error);
    return null;
  }
}

/**
 * Verify if a game title matches a GOG product
 * Returns the GOG product ID if found
 */
export async function verifyGOGGame(gameTitle: string): Promise<{ verified: boolean; gogId?: number; gogTitle?: string; version?: string; buildId?: string } | null> {
  try {
    logger.info(`🔍 Verifying GOG game: "${gameTitle}"`);
    
    const results = await searchGOGDB(gameTitle);
    
    if (results.length === 0) {
      logger.info(`⚠️ No GOG matches found for "${gameTitle}"`);
      return { verified: false };
    }
    
    // Get the best match (first result)
    const bestMatch = results[0];
    
    // Get version info
    const versionInfo = await getGOGDBLatestVersion(bestMatch.id);
    
    logger.info(`✅ GOG game verified: ${bestMatch.title} (ID: ${bestMatch.id})`);
    
    return {
      verified: true,
      gogId: bestMatch.id,
      gogTitle: bestMatch.title,
      version: versionInfo?.version,
      buildId: versionInfo?.buildId
    };
    
  } catch (error) {
    logger.error(`❌ GOG verification failed for "${gameTitle}":`, error);
    return null;
  }
}

/**
 * Compare version with GOG's latest version
 */
export async function compareWithGOGVersion(
  gogId: number,
  currentVersion?: string,
  currentBuild?: string
): Promise<{
  hasUpdate: boolean;
  latestVersion?: string;
  latestBuild?: string;
  currentVersion?: string;
  currentBuild?: string;
} | null> {
  try {
    const latestInfo = await getGOGDBLatestVersion(gogId);
    
    if (!latestInfo) {
      return null;
    }
    
    // Compare versions
    let hasUpdate = false;
    
    if (currentVersion && latestInfo.version) {
      hasUpdate = currentVersion !== latestInfo.version;
    } else if (currentBuild && latestInfo.buildId) {
      hasUpdate = currentBuild !== latestInfo.buildId;
    } else if (latestInfo.version || latestInfo.buildId) {
      // We have GOG version but no current version - assume update available
      hasUpdate = true;
    }
    
    return {
      hasUpdate,
      latestVersion: latestInfo.version,
      latestBuild: latestInfo.buildId,
      currentVersion,
      currentBuild
    };
    
  } catch (error) {
    logger.error(`❌ Failed to compare with GOG version for product ${gogId}:`, error);
    return null;
  }
}

const gogdbApi = {
  searchGOGDB,
  getGOGDBProduct,
  getGOGDBBuilds,
  getGOGDBLatestVersion,
  verifyGOGGame,
  compareWithGOGVersion
};

export default gogdbApi;
