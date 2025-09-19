import fetch from 'node-fetch';
import TrackedGame from '../models/trackedGame.js';
import { EventEmitter } from 'events';

class UpdateDetectionService extends EventEmitter {
    constructor() {
        super();
        this.GAMEAPI_URL = "https://gameapi.a7a8524.workers.dev";
        this.checkInterval = 30 * 60 * 1000; // 30 minutes
        this.isRunning = false;
        this.lastChecks = new Map(); // Cache last check results
    }

    start() {
        if (this.isRunning) return;
        
        console.log('Starting update detection service...');
        this.isRunning = true;
        
        // Initial check
        this.checkAllTrackedGames();
        
        // Schedule periodic checks
        this.intervalId = setInterval(() => {
            this.checkAllTrackedGames();
        }, this.checkInterval);
    }

    stop() {
        if (!this.isRunning) return;
        
        console.log('Stopping update detection service...');
        this.isRunning = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }

    async checkAllTrackedGames() {
        try {
            console.log('Checking for game updates...');
            const gamesToCheck = await TrackedGame.findPendingChecks();
            console.log(`Found ${gamesToCheck.length} games to check`);

            for (const game of gamesToCheck) {
                try {
                    await this.checkGameForUpdates(game);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
                } catch (error) {
                    console.error(`Error checking game ${game.title}:`, error);
                }
            }
        } catch (error) {
            console.error('Error in checkAllTrackedGames:', error);
        }
    }

    async checkGameForUpdates(trackedGame) {
        try {
            console.log(`Checking updates for: ${trackedGame.title}`);
            
            // Search for the game to get current data
            const searchResults = await this.searchGame(trackedGame.title);
            
            if (!searchResults || searchResults.length === 0) {
                console.log(`No search results for ${trackedGame.title}`);
                await trackedGame.markAsChecked();
                return;
            }

            // Find the best match (usually first result with exact/close title match)
            const currentGameData = this.findBestMatch(searchResults, trackedGame.title);
            
            if (!currentGameData) {
                console.log(`No good match found for ${trackedGame.title}`);
                await trackedGame.markAsChecked();
                return;
            }

            // Extract version/update info using various strategies
            const detectedVersion = await this.extractVersionInfo(currentGameData);
            const lastCachedData = this.lastChecks.get(trackedGame._id.toString());

            // Compare with cached data to detect changes
            const hasUpdate = await this.detectUpdate(trackedGame, currentGameData, detectedVersion, lastCachedData);

            if (hasUpdate) {
                console.log(`Update detected for ${trackedGame.title}: ${detectedVersion}`);
                
                const updateInfo = await this.extractUpdateInfo(currentGameData);
                await trackedGame.updateVersion(
                    detectedVersion,
                    updateInfo.changelog,
                    updateInfo.metadata
                );

                this.emit('gameUpdate', {
                    game: trackedGame,
                    version: detectedVersion,
                    updateInfo
                });
            }

            // Cache the current check result
            this.lastChecks.set(trackedGame._id.toString(), {
                timestamp: Date.now(),
                data: currentGameData,
                version: detectedVersion
            });

            await trackedGame.markAsChecked();

        } catch (error) {
            console.error(`Error checking ${trackedGame.title}:`, error);
            await trackedGame.markAsChecked();
        }
    }

    async searchGame(title) {
        try {
            const searchUrl = `${this.GAMEAPI_URL}/search?search=${encodeURIComponent(title)}&limit=5`;
            console.log(`Searching: ${searchUrl}`);
            
            const response = await fetch(searchUrl);
            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json();
            return data.success && data.results ? data.results : [];
        } catch (error) {
            console.error(`Search error for "${title}":`, error);
            return [];
        }
    }

    findBestMatch(searchResults, originalTitle) {
        // Score each result based on title similarity
        const scoredResults = searchResults.map(result => {
            const score = this.calculateTitleSimilarity(originalTitle, result.title);
            return { ...result, score };
        });

        // Sort by score (descending) and return the best match
        scoredResults.sort((a, b) => b.score - a.score);
        
        // Only return matches with reasonable similarity (> 0.6)
        return scoredResults[0] && scoredResults[0].score > 0.6 ? scoredResults[0] : null;
    }

    calculateTitleSimilarity(title1, title2) {
        // Normalize titles (lowercase, remove special chars, trim)
        const normalize = (str) => str.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const t1 = normalize(title1);
        const t2 = normalize(title2);

        if (t1 === t2) return 1.0;

        // Use Levenshtein distance for similarity
        const distance = this.levenshteinDistance(t1, t2);
        const maxLength = Math.max(t1.length, t2.length);
        
        return 1 - (distance / maxLength);
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[str2.length][str1.length];
    }

    async extractVersionInfo(gameData) {
        let version = null;

        // Strategy 1: Look for version in title
        const titleMatch = gameData.title.match(/v?(\d+\.?\d*\.?\d*)/i);
        if (titleMatch) {
            version = titleMatch[1];
        }

        // Strategy 2: Look for date-based versioning
        if (!version && gameData.date) {
            version = new Date(gameData.date).toISOString().split('T')[0];
        }

        // Strategy 3: Use post ID or unique identifier as version
        if (!version && gameData.id) {
            version = gameData.id.toString();
        }

        // Strategy 4: Extract from excerpt/description
        if (!version && gameData.excerpt) {
            const excerptMatch = gameData.excerpt.match(/version?\s*:?\s*v?(\d+\.?\d*\.?\d*)/i);
            if (excerptMatch) {
                version = excerptMatch[1];
            }
        }

        // Fallback: use current timestamp as version
        if (!version) {
            version = Date.now().toString();
        }

        return version;
    }

    async detectUpdate(trackedGame, currentData, currentVersion, cachedData) {
        // If no previous version, this is the first check
        if (!trackedGame.currentVersion) {
            return false; // Don't consider first check as an update
        }

        // Check if version changed
        if (trackedGame.currentVersion !== currentVersion) {
            return true;
        }

        // Check if content significantly changed (if cached data available)
        if (cachedData && cachedData.data) {
            const contentChanged = this.detectContentChanges(cachedData.data, currentData);
            if (contentChanged) {
                return true;
            }
        }

        return false;
    }

    detectContentChanges(oldData, newData) {
        // Check if title changed (might indicate repack/update)
        if (oldData.title !== newData.title) {
            return true;
        }

        // Check if excerpt/description changed significantly
        if (oldData.excerpt && newData.excerpt) {
            const similarity = this.calculateTitleSimilarity(oldData.excerpt, newData.excerpt);
            if (similarity < 0.8) { // 80% similarity threshold
                return true;
            }
        }

        // Check if post date changed (updated post)
        if (oldData.date !== newData.date) {
            return true;
        }

        return false;
    }

    async extractUpdateInfo(gameData) {
        return {
            changelog: gameData.excerpt || 'No changelog available',
            metadata: {
                source: gameData.source || 'Unknown',
                url: gameData.link || gameData.url,
                lastModified: gameData.date ? new Date(gameData.date) : new Date(),
                format: this.extractFormat(gameData),
                size: this.extractSize(gameData)
            }
        };
    }

    extractFormat(gameData) {
        const text = (gameData.title + ' ' + (gameData.excerpt || '')).toLowerCase();
        
        if (text.includes('fitgirl')) return 'FitGirl Repack';
        if (text.includes('dodi')) return 'DODI Repack';
        if (text.includes('steamrip')) return 'SteamRip';
        if (text.includes('codex')) return 'CODEX';
        if (text.includes('plaza')) return 'PLAZA';
        
        return 'Unknown';
    }

    extractSize(gameData) {
        const text = (gameData.title + ' ' + (gameData.excerpt || '')).toLowerCase();
        const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:gb|mb|tb))/i);
        return sizeMatch ? sizeMatch[1] : null;
    }
}

export default UpdateDetectionService;