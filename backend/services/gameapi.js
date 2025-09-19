const axios = require('axios');
const { EventEmitter } = require('events');

class GameAPIService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            apiUrl: config.apiUrl || 'https://your-worker-subdomain.workers.dev',
            cacheTimeout: config.cacheTimeout || 3600000, // 1 hour
            ...config
        };
        
        this.cache = {
            recent: new Map(),
            search: new Map(),
            decrypted: new Map()
        };
    }

    /**
     * Search for games across all supported sources
     * @param {string} query - The search query
     * @param {string} site - Optional site filter (skidrow, freegog, gamedrive, all)
     * @returns {Promise<Array>} Array of game results
     */
    async searchGames(query, site = 'all') {
        try {
            const cacheKey = `${query}:${site}`;
            const cached = this.cache.search.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp < this.config.cacheTimeout)) {
                return cached.data;
            }

            const response = await axios.get(`${this.config.apiUrl}`, {
                params: {
                    search: query,
                    site: site
                }
            });

            if (response.data.success) {
                const results = response.data.results;
                this.cache.search.set(cacheKey, {
                    data: results,
                    timestamp: Date.now()
                });
                return results;
            }

            throw new Error(response.data.error || 'Failed to search games');
        } catch (error) {
            console.error('Error searching games:', error);
            throw error;
        }
    }

    /**
     * Get recent game uploads
     * @returns {Promise<Array>} Array of recent game uploads
     */
    async getRecentUploads() {
        try {
            const cached = this.cache.recent.get('recent');
            
            if (cached && (Date.now() - cached.timestamp < this.config.cacheTimeout)) {
                return cached.data;
            }

            const response = await axios.get(`${this.config.apiUrl}/recent`);

            if (response.data.success) {
                const results = response.data.results;
                this.cache.recent.set('recent', {
                    data: results,
                    timestamp: Date.now()
                });
                return results;
            }

            throw new Error(response.data.error || 'Failed to get recent uploads');
        } catch (error) {
            console.error('Error getting recent uploads:', error);
            throw error;
        }
    }

    /**
     * Decrypt a crypt.gg hash into a direct download link
     * @param {string} hash - The crypt hash to decrypt
     * @returns {Promise<Object>} Object containing the decrypted URL and service
     */
    async decryptLink(hash) {
        try {
            const cached = this.cache.decrypted.get(hash);
            
            if (cached && (Date.now() - cached.timestamp < this.config.cacheTimeout)) {
                return cached.data;
            }

            const response = await axios.get(`${this.config.apiUrl}/decrypt`, {
                params: { hash }
            });

            if (response.data.success) {
                this.cache.decrypted.set(hash, {
                    data: response.data,
                    timestamp: Date.now()
                });
                return response.data;
            }

            throw new Error(response.data.error || 'Failed to decrypt link');
        } catch (error) {
            console.error('Error decrypting link:', error);
            throw error;
        }
    }

    /**
     * Process download links, including decrypting any crypt links
     * @param {Array} downloadLinks - Array of download links to process
     * @returns {Promise<Array>} Processed download links with decrypted URLs where applicable
     */
    async processDownloadLinks(downloadLinks) {
        try {
            const processedLinks = await Promise.all(downloadLinks.map(async (link) => {
                // Handle crypt links
                if (link.type === 'crypt') {
                    try {
                        const decrypted = await this.decryptLink(link.url.split('#')[1]);
                        return {
                            ...link,
                            decryptedUrl: decrypted.url,
                            service: decrypted.service,
                            status: 'decrypted'
                        };
                    } catch (error) {
                        return {
                            ...link,
                            status: 'decrypt_failed',
                            error: error.message
                        };
                    }
                }
                
                // Pass through other link types
                return {
                    ...link,
                    status: 'ready'
                };
            }));

            return processedLinks;
        } catch (error) {
            console.error('Error processing download links:', error);
            throw error;
        }
    }

    /**
     * Get proxied image URL to avoid CORS issues
     * @param {string} imageUrl - Original image URL
     * @returns {string} Proxied image URL
     */
    getProxiedImageUrl(imageUrl) {
        if (!imageUrl) return null;
        return `${this.config.apiUrl}/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    }

    /**
     * Clear all caches
     */
    clearCache() {
        this.cache.recent.clear();
        this.cache.search.clear();
        this.cache.decrypted.clear();
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            recent: this.cache.recent.size,
            search: this.cache.search.size,
            decrypted: this.cache.decrypted.size
        };
    }
}

module.exports = GameAPIService;