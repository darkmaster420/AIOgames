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

    // Convert GOG catalog format to our format
    return data.products.map((product: GOGCatalogProduct) => ({
      id: parseInt(product.id, 10),
      title: product.title,
      slug: product.slug,
      type: product.productType || 'game',
      release_date: product.releaseDate || null,
      developers: product.developers ? product.developers.join(', ') : null,
      publishers: product.publishers ? product.publishers.join(', ') : null,
      genres: product.genres ? product.genres.map(g => g.name).join(', ') : null
    }));
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
 * Get builds from GOGDB API (by parsing directory listing)
 */
export async function getGOGDBBuildsFromIndex(
  productId: number,
  os: 'windows' | 'mac' | 'linux' = 'windows'
): Promise<GOGDBBuild[]> {
  try {
    // GOGDB stores builds as individual JSON files in a directory
    // We need to fetch the directory listing and parse it
    const buildsDir = `${GOGDB_API}/products/${productId}/builds/`;
    
    logger.info(`🔍 Fetching GOGDB builds directory for product ${productId}`);
    
    const response = await fetch(buildsDir, {
      headers: {
        'User-Agent': 'AIOgames/1.3.1'
      }
    });
    
    if (!response.ok) {
      logger.warn(`⚠️ GOGDB builds not found for ${productId}`);
      return [];
    }

    const html = await response.text();
    
    // Parse HTML to extract build JSON filenames
    // Example: <a href="59050354429215144.json">59050354429215144.json</a>
    const buildFileRegex = /<a href="(\d+)\.json">/g;
    const buildIds: string[] = [];
    let match;
    
    while ((match = buildFileRegex.exec(html)) !== null) {
      buildIds.push(match[1]);
    }
    
    if (buildIds.length === 0) {
      logger.warn(`⚠️ No build files found for product ${productId}`);
      return [];
    }
    
    logger.info(`✅ Found ${buildIds.length} builds for product ${productId}`);
    
    // Fetch the latest build (last in the list, as they're sorted by date in the HTML)
    const latestBuildId = buildIds[buildIds.length - 1];
    const buildUrl = `${GOGDB_API}/products/${productId}/builds/${latestBuildId}.json`;
    
    const buildResponse = await fetch(buildUrl, {
      headers: {
        'User-Agent': 'AIOgames/1.3.1'
      }
    });
    
    if (!buildResponse.ok) {
      logger.error(`❌ Failed to fetch build ${latestBuildId}`);
      return [];
    }
    
    const buildData = await buildResponse.json();
    
    // Check if the build matches the requested OS
    const platform = buildData.platform || 'windows';
    if (platform !== os) {
      logger.warn(`⚠️ Build ${latestBuildId} is for ${platform}, not ${os}`);
      return [];
    }
    
    // Extract version from the build
    // GOGDB build files don't have a version field, but we can get it from tags or other fields
    const version = buildData.version || buildData.versionName || null;
    
    return [{
      product_id: productId,
      build_id: latestBuildId,
      version: version,
      generation: buildData.version || 2,
      date_published: buildData.datePublished || new Date().toISOString(),
      os: platform
    }];
  } catch (error) {
    logger.error('❌ Failed to fetch builds from GOGDB:', error);
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
