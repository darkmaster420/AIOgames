/**
 * GOG + GOGDB API Manager
 * Uses GOG's official catalog API for searches, GOGDB for product details
 * No local database needed - fast and always up-to-date
 */

import logger from './logger';

const GOG_CATALOG_API = 'https://catalog.gog.com/v1/catalog';
const GOGDB_API = 'https://www.gogdb.org/data';

interface GOGDBIndexGame {
  id: number;
  title: string;
  slug: string;
  type: string;
  release_date: string | null;
  developers: string | null;
  publishers: string | null;
  genres: string | null;
}

interface GOGDBBuild {
  product_id: number;
  build_id: string;
  version: string | null;
  generation: number;
  date_published: string;
  os: string;
  listed?: boolean;
  public?: boolean;
}

interface GOGCatalogProduct {
  id: string;
  slug: string;
  title: string;
  productType: string;
  releaseDate?: string;
  developers?: string[];
  publishers?: string[];
  genres?: { name: string; slug: string }[];
}

interface GOGDBProductBuild {
  id: number;
  os: string;
  version?: string;
  generation: number;
  date_published: string;
  branch?: string | null;
  listed?: boolean;
  public?: boolean;
  tags?: string[];
}

/**
 * Initialize the GOGDB (no-op for API-based approach)
 */
export async function initializeGOGDB(): Promise<void> {
  logger.info('✅ GOG API initialized (using GOG search + GOGDB details)');
}

/**
 * Search for games using GOG's catalog API
 */
export async function searchGOGDBIndex(query: string, limit: number = 10): Promise<GOGDBIndexGame[]> {
  try {
    const searchUrl = `${GOG_CATALOG_API}?query=${encodeURIComponent(query)}&limit=${limit}`;
    
    logger.info(`🔍 Searching GOG catalog: ${query}`);
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'AIOgames/1.3.1'
      }
    });

    if (!response.ok) {
      throw new Error(`GOG API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.products || data.products.length === 0) {
      logger.info(`📭 No results found for: ${query}`);
      return [];
    }

    logger.info(`✅ Found ${data.products.length} results for: ${query}`);

    // Convert GOG catalog format to our format and filter to games only
    const allResults: GOGDBIndexGame[] = data.products.map((product: GOGCatalogProduct) => ({
      id: parseInt(product.id, 10),
      title: product.title,
      slug: product.slug,
      type: product.productType || 'game',
      release_date: product.releaseDate || null,
      developers: product.developers ? product.developers.join(', ') : null,
      publishers: product.publishers ? product.publishers.join(', ') : null,
      genres: product.genres ? product.genres.map(g => g.name).join(', ') : null
    }));

    // Prioritize games, filter out DLCs and packs unless no games found
    const gamesOnly = allResults.filter((r: GOGDBIndexGame) => r.type === 'game');
    const results = gamesOnly.length > 0 ? gamesOnly : allResults;

    logger.info(`🎮 Filtered to ${results.length} game(s) from ${allResults.length} total results`);
    
    return results;
  } catch (error) {
    logger.error('❌ Failed to search GOG catalog:', error);
    return [];
  }
}

/**
 * Get a specific product from GOGDB by ID
 */
export async function getGOGDBProductFromIndex(productId: number): Promise<GOGDBIndexGame | null> {
  try {
    // GOGDB doesn't have a direct product JSON endpoint
    // We'll use GOG's catalog API to get product details
    const catalogUrl = `${GOG_CATALOG_API}?productId=${productId}`;
    
    logger.info(`🔍 Fetching product from GOG catalog: ${productId}`);
    
    const response = await fetch(catalogUrl, {
      headers: {
        'User-Agent': 'AIOgames/1.3.1'
      }
    });

    if (!response.ok) {
      logger.warn(`⚠️ GOG product ${productId} not found (${response.status})`);
      return null;
    }

    const data = await response.json();
    
    if (!data.products || data.products.length === 0) {
      logger.warn(`⚠️ No product found for ID ${productId}`);
      return null;
    }

    const product = data.products[0];
    
    return {
      id: productId,
      title: product.title || '',
      slug: product.slug || '',
      type: product.productType || 'game',
      release_date: product.releaseDate || null,
      developers: product.developers ? product.developers.join(', ') : null,
      publishers: product.publishers ? product.publishers.join(', ') : null,
      genres: product.genres ? product.genres.map((g: { name: string }) => g.name).join(', ') : null
    };
  } catch (error) {
    logger.error(`❌ Failed to fetch GOG product ${productId}:`, error);
    return null;
  }
}

/**
 * Get builds from GOGDB API (using product.json)
 */
export async function getGOGDBBuildsFromIndex(
  productId: number,
  os: 'windows' | 'mac' | 'linux' = 'windows'
): Promise<GOGDBBuild[]> {
  try {
    // GOGDB has a product.json file with all builds info
    const productUrl = `${GOGDB_API}/products/${productId}/product.json`;
    
    logger.info(`🔍 Fetching GOGDB product data for ${productId} from ${productUrl}`);
    
    const response = await fetch(productUrl, {
      headers: {
        'User-Agent': 'AIOgames/1.3.4'
      }
    });
    
    if (!response.ok) {
      logger.warn(`⚠️ GOGDB product data not found for ${productId} - Status: ${response.status}`);
      return [];
    }

    const data = await response.json();
    
    if (!data.builds || !Array.isArray(data.builds)) {
      logger.warn(`⚠️ No builds found in product data for ${productId}`);
      return [];
    }
    
    // Filter builds by OS and generation, prefer listed/public builds
    const allBuilds: GOGDBBuild[] = data.builds
      .filter((build: GOGDBProductBuild) => build.os === os && build.generation === 2)
      .map((build: GOGDBProductBuild) => ({
        product_id: productId,
        build_id: build.id.toString(),
        version: build.version || null,
        generation: build.generation,
        date_published: build.date_published,
        os: build.os,
        listed: build.listed,
        public: build.public
      }));
    
    if (allBuilds.length === 0) {
      logger.warn(`⚠️ No ${os} builds found for product ${productId}`);
      return [];
    }
    
    // Prioritize listed builds, then public builds
    const listedBuilds = allBuilds.filter((b: GOGDBBuild) => b.listed);
    const publicBuilds = allBuilds.filter((b: GOGDBBuild) => b.public);
    const builds = listedBuilds.length > 0 ? listedBuilds : (publicBuilds.length > 0 ? publicBuilds : allBuilds);
    
    logger.info(`📊 Product ${productId}: Total builds: ${allBuilds.length}, Listed: ${listedBuilds.length}, Public: ${publicBuilds.length}, Using: ${builds.length}`);
    
    // Sort by date (newest first)
    builds.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
    
    logger.info(`✅ Found ${builds.length} ${os} builds for product ${productId}, latest version: ${builds[0].version || 'unknown'} (listed: ${builds[0].listed}, date: ${builds[0].date_published})`);
    
    return builds;
  } catch (error) {
    logger.error(`❌ Failed to fetch builds from GOGDB for product ${productId}:`, error);
    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
    return [];
  }
}

/**
 * Get latest version/build info for a GOG product
 */
export async function getLatestGOGVersion(
  productId: number,
  os: 'windows' | 'mac' | 'linux' = 'windows'
): Promise<{
  version?: string;
  buildId?: string;
  date?: string;
} | null> {
  try {
    const builds = await getGOGDBBuildsFromIndex(productId, os);
    
    if (builds.length === 0) {
      return null;
    }

    const latestBuild = builds[0];
    return {
      version: latestBuild.version || undefined,
      buildId: latestBuild.build_id,
      date: latestBuild.date_published
    };
  } catch (error) {
    logger.error('❌ Failed to get latest GOG version:', error);
    return null;
  }
}

/**
 * Close database (no-op for API-based approach)
 */
export function closeGOGDB(): void {
  logger.info('ℹ️ Using live GOG API - no database to close');
}

/**
 * Update index (no-op for API-based approach)
 */
export async function updateGOGDBIndex(): Promise<void> {
  logger.info('ℹ️ Using live GOG API - no index update needed');
}

export type { GOGDBIndexGame, GOGDBBuild };
