const axios = require('axios');
const { EventEmitter } = require('events');

class SteamService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.enabled = !!config.steamApiKey;
        this.config = {
            apiKey: config.steamApiKey,
            updateCheckInterval: config.updateCheckInterval || 3600000, // 1 hour
            ...config
        };
        
        this.knownVersions = new Map(); // Store known versions for comparison
    }

    async init() {
        if (!this.enabled) {
            console.log('Steam integration disabled - no API key provided');
            return;
        }

        // Start the update checker
        this.startUpdateChecker();
    }

    isEnabled() {
        return this.enabled;
    }

    startUpdateChecker() {
        if (!this.enabled) return;

        setInterval(async () => {
            try {
                await this.checkForUpdates();
            } catch (error) {
                console.error('Error checking for updates:', error);
            }
        }, this.config.updateCheckInterval);
    }

    async getGameDetails(appId) {
        try {
            // Using Steam Store API
            const response = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
            
            if (response.data[appId].success) {
                return response.data[appId].data;
            }
            throw new Error('Failed to fetch game details');
        } catch (error) {
            console.error(`Error fetching game details for ${appId}:`, error);
            throw error;
        }
    }

    async getGameNews(appId) {
        try {
            const response = await axios.get(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=10`);
            return response.data.appnews.newsitems;
        } catch (error) {
            console.error(`Error fetching game news for ${appId}:`, error);
            throw error;
        }
    }

    async checkForUpdates() {
        try {
            // Get list of games to monitor from database
            const monitoredGames = await this.getMonitoredGames();

            for (const game of monitoredGames) {
                const buildId = await this.getCurrentBuildId(game.appId);
                const knownBuildId = this.knownVersions.get(game.appId);

                if (knownBuildId && buildId !== knownBuildId) {
                    // Emit update event
                    this.emit('gameUpdate', {
                        appId: game.appId,
                        oldBuildId: knownBuildId,
                        newBuildId: buildId,
                        timestamp: new Date()
                    });
                }

                this.knownVersions.set(game.appId, buildId);
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
        }
    }

    async getCurrentBuildId(appId) {
        try {
            // This is where we'd integrate with SteamDB
            // For now, we'll use the Steam Web API to get the most recent update timestamp
            const news = await this.getGameNews(appId);
            if (news.length > 0) {
                return news[0].date; // Use the most recent news date as a proxy for build ID
            }
            return null;
        } catch (error) {
            console.error(`Error getting current build ID for ${appId}:`, error);
            throw error;
        }
    }

    async getMonitoredGames() {
        // This should be implemented to fetch games from your database
        // For now, return an empty array
        return [];
    }

    // Helper method to parse SteamDB data (to be implemented)
    async parseSteamDBData(appId) {
        // This would be implemented to scrape or use unofficial API
        // Need to be careful with rate limiting and terms of service
        throw new Error('Not implemented');
    }
}

module.exports = SteamService;