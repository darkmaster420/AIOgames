/**
 * GOGDB SQLite Index Manager
 * Downloads and queries the GOGDB index.sqlite3 file for fast local searches
 * Updates automatically every 24 hours
 * Uses sql.js for pure JavaScript SQLite implementation
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import initSqlJs, { Database } from 'sql.js';
import logger from './logger';

const GOGDB_INDEX_URL = 'https://www.gogdb.org/data/index.sqlite3';
const INDEX_DIR = path.join(process.cwd(), 'data', 'gogdb');
const INDEX_PATH = path.join(INDEX_DIR, 'index.sqlite3');
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface SqlJsStatic {
  Database: new (data?: Buffer | Uint8Array | null) => Database;
}

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

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

/**
 * Download the GOGDB index file
 */
async function downloadIndex(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info('📥 Downloading GOGDB index...');
    
    // Ensure directory exists
    if (!fs.existsSync(INDEX_DIR)) {
      fs.mkdirSync(INDEX_DIR, { recursive: true });
    }

    const file = fs.createWriteStream(INDEX_PATH);
    
    https.get(GOGDB_INDEX_URL, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        logger.info('✅ GOGDB index downloaded successfully');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(INDEX_PATH, () => {}); // Delete incomplete file
      reject(err);
    });
  });
}

/**
 * Check if index needs updating (older than 24 hours)
 */
function needsUpdate(): boolean {
  if (!fs.existsSync(INDEX_PATH)) {
    return true;
  }

  const stats = fs.statSync(INDEX_PATH);
  const age = Date.now() - stats.mtimeMs;
  return age > UPDATE_INTERVAL;
}

/**
 * Initialize SQL.js and open database
 */
async function openDatabase(): Promise<Database> {
  if (!SQL) {
    // Provide the WASM file location
    SQL = await initSqlJs({
      locateFile: (file: string) => {
        return `https://sql.js.org/dist/${file}`;
      }
    });
  }

  const buffer = fs.readFileSync(INDEX_PATH);
  return new SQL.Database(buffer);
}

/**
 * Initialize the GOGDB index (download if needed, open database)
 */
export async function initializeGOGDB(): Promise<void> {
  try {
    // Download if needed
    if (needsUpdate()) {
      await downloadIndex();
    }

    // Open database
    if (!db) {
      db = await openDatabase();
      logger.info('✅ GOGDB index initialized');
    }
  } catch (error) {
    logger.error('❌ Failed to initialize GOGDB index:', error);
    throw error;
  }
}

/**
 * Search for games in the local GOGDB index
 */
export async function searchGOGDBIndex(query: string, limit: number = 10): Promise<GOGDBIndexGame[]> {
  if (!db) {
    await initializeGOGDB();
  }

  if (!db) {
    throw new Error('Database not initialized');
  }

  try {
    const searchTerm = `%${query.toLowerCase()}%`;
    const exactTerm = query.toLowerCase();
    const prefixTerm = `${query.toLowerCase()}%`;

    const results = db.exec(`
      SELECT id, title, slug, type, release_date, developers, publishers, genres
      FROM products
      WHERE LOWER(title) LIKE ? OR LOWER(slug) LIKE ?
      ORDER BY CASE
        WHEN LOWER(title) = ? THEN 0
        WHEN LOWER(title) LIKE ? THEN 1
        ELSE 2
      END, title
      LIMIT ?
    `, [searchTerm, searchTerm, exactTerm, prefixTerm, limit]);

    if (results.length === 0) {
      return [];
    }

    const [result] = results;
    return result.values.map((row: unknown[]) => ({
      id: row[0] as number,
      title: row[1] as string,
      slug: row[2] as string,
      type: row[3] as string,
      release_date: row[4] as string | null,
      developers: row[5] as string | null,
      publishers: row[6] as string | null,
      genres: row[7] as string | null
    }));
  } catch (error) {
    logger.error('❌ Failed to search GOGDB index:', error);
    return [];
  }
}

/**
 * Get a specific product from the index by ID
 */
export async function getGOGDBProductFromIndex(productId: number): Promise<GOGDBIndexGame | null> {
  if (!db) {
    await initializeGOGDB();
  }

  if (!db) {
    throw new Error('Database not initialized');
  }

  try {
    const results = db.exec(`
      SELECT id, title, slug, type, release_date, developers, publishers, genres
      FROM products
      WHERE id = ?
    `, [productId]);

    if (results.length === 0 || results[0].values.length === 0) {
      return null;
    }

    const row = results[0].values[0];
    return {
      id: row[0] as number,
      title: row[1] as string,
      slug: row[2] as string,
      type: row[3] as string,
      release_date: row[4] as string | null,
      developers: row[5] as string | null,
      publishers: row[6] as string | null,
      genres: row[7] as string | null
    };
  } catch (error) {
    logger.error('❌ Failed to get product from GOGDB index:', error);
    return null;
  }
}

/**
 * Get builds from index or fallback to API
 */
export async function getGOGDBBuildsFromIndex(
  productId: number,
  os: 'windows' | 'mac' | 'linux' = 'windows'
): Promise<GOGDBBuild[]> {
  if (!db) {
    await initializeGOGDB();
  }

  if (!db) {
    throw new Error('Database not initialized');
  }

  try {
    // Try to get builds from index
    const results = db.exec(`
      SELECT product_id, build_id, version, generation, date_published, os
      FROM builds
      WHERE product_id = ? AND os = ?
      ORDER BY generation DESC, date_published DESC
    `, [productId, os]);

    if (results.length > 0 && results[0].values.length > 0) {
      return results[0].values.map((row: unknown[]) => ({
        product_id: row[0] as number,
        build_id: row[1] as string,
        version: row[2] as string | null,
        generation: row[3] as number,
        date_published: row[4] as string,
        os: row[5] as string
      }));
    }
  } catch {
    // Builds table might not exist in index, fallback to API
    logger.warn('⚠️ Builds table not found in index, falling back to API');
  }

  // Fallback to API
  try {
    const response = await fetch(`https://www.gogdb.org/data/products/${productId}/builds.json`);
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const builds: GOGDBBuild[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [buildId, buildData] of Object.entries(data as Record<string, any>)) {
      if (buildData.os === os && buildData.generation === 2) {
        builds.push({
          product_id: productId,
          build_id: buildId,
          version: buildData.version_name || buildData.version || null,
          generation: buildData.generation,
          date_published: buildData.date_published,
          os: buildData.os
        });
      }
    }

    // Sort by date (newest first)
    builds.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
    return builds;
  } catch (error) {
    logger.error('❌ Failed to fetch builds from API:', error);
    return [];
  }
}

/**
 * Get the latest version for a product
 */
export async function getLatestGOGVersion(
  productId: number,
  os: 'windows' | 'mac' | 'linux' = 'windows'
): Promise<{ version?: string; buildId?: string; date?: string } | null> {
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
 * Close the database connection
 */
export function closeGOGDB(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('🔒 GOGDB database closed');
  }
}

/**
 * Force update the index (re-download)
 */
export async function updateGOGDBIndex(): Promise<void> {
  try {
    closeGOGDB();
    await downloadIndex();
    db = await openDatabase();
    logger.info('✅ GOGDB index updated successfully');
  } catch (error) {
    logger.error('❌ Failed to update GOGDB index:', error);
    throw error;
  }
}
