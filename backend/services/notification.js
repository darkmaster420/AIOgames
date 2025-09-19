const Game = require('../models/game');
const { EventEmitter } = require('events');

class NotificationService extends EventEmitter {
    constructor(io) {
        super();
        this.io = io; // Socket.io instance
        this.notifications = new Map();
    }

    async init() {
        // Listen for game updates
        this.on('gameUpdate', this.handleGameUpdate.bind(this));
    }

    async handleGameUpdate(updateData) {
        try {
            const { appId, oldBuildId, newBuildId } = updateData;
            
            // Update game in database
            const game = await Game.findOne({ appId });
            if (!game) return;

            await game.markUpdateAvailable(newBuildId);

            // Notify connected clients
            this.io.emit('gameUpdate', {
                gameId: game._id,
                appId: game.appId,
                name: game.name,
                oldBuildId,
                newBuildId,
                timestamp: new Date()
            });

            // Store notification
            this.storeNotification({
                type: 'gameUpdate',
                gameId: game._id,
                appId: game.appId,
                name: game.name,
                message: `Update available for ${game.name}`,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Error handling game update:', error);
        }
    }

    storeNotification(notification) {
        const gameId = notification.gameId.toString();
        if (!this.notifications.has(gameId)) {
            this.notifications.set(gameId, []);
        }
        
        const gameNotifications = this.notifications.get(gameId);
        gameNotifications.push(notification);
        
        // Keep only last 10 notifications per game
        if (gameNotifications.length > 10) {
            gameNotifications.shift();
        }
    }

    getNotifications(gameId) {
        return this.notifications.get(gameId.toString()) || [];
    }

    getAllNotifications() {
        const allNotifications = [];
        for (const notifications of this.notifications.values()) {
            allNotifications.push(...notifications);
        }
        return allNotifications.sort((a, b) => b.timestamp - a.timestamp);
    }

    clearNotifications(gameId) {
        if (gameId) {
            this.notifications.delete(gameId.toString());
        } else {
            this.notifications.clear();
        }
    }
}

module.exports = NotificationService;