const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    appId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    steamData: {
        currentBuildId: String,
        lastUpdateCheck: Date,
        lastUpdate: Date,
        releases: [{
            buildId: String,
            timestamp: Date,
            changelog: String
        }]
    },
    metadata: {
        releaseDate: Date,
        developer: String,
        publisher: String,
        genres: [String],
        tags: [String],
        description: String,
        headerImage: String
    },
    monitoring: {
        isActive: {
            type: Boolean,
            default: true
        },
        lastNotification: Date,
        updateAvailable: Boolean
    },
    downloads: [{
        version: String,
        buildId: String,
        sources: [{
            type: String, // 'steam', 'external'
            url: String,
            service: String, // download service used
            status: String
        }],
        addedAt: Date
    }]
}, {
    timestamps: true
});

// Indexes
gameSchema.index({ appId: 1 });
gameSchema.index({ 'monitoring.isActive': 1 });
gameSchema.index({ 'monitoring.updateAvailable': 1 });

// Methods
gameSchema.methods.markUpdateAvailable = async function(buildId, changelog) {
    this.monitoring.updateAvailable = true;
    this.steamData.currentBuildId = buildId;
    this.steamData.releases.push({
        buildId,
        timestamp: new Date(),
        changelog
    });
    return this.save();
};

gameSchema.methods.markUpdateNotified = async function() {
    this.monitoring.lastNotification = new Date();
    return this.save();
};

// Static methods
gameSchema.statics.findNeedingUpdate = function() {
    return this.find({
        'monitoring.isActive': true,
        'monitoring.updateAvailable': true
    });
};

gameSchema.statics.findMonitored = function() {
    return this.find({
        'monitoring.isActive': true
    });
};

const Game = mongoose.model('Game', gameSchema);

module.exports = Game;