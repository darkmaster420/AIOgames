import mongoose from 'mongoose';

const trackedGameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    lastChecked: {
        type: Date,
        default: Date.now
    },
    hasUpdates: {
        type: Boolean,
        default: false
    },
    dateAdded: {
        type: Date,
        default: Date.now
    },
    // Enhanced update tracking fields
    currentVersion: {
        type: String,
        default: null
    },
    lastKnownVersion: {
        type: String,
        default: null
    },
    updateHistory: [{
        version: String,
        date: { type: Date, default: Date.now },
        changes: String,
        size: String,
        source: String
    }],
    metadata: {
        source: String, // e.g., 'steamrip', 'fitgirl', 'dodi', etc.
        releaseDate: Date,
        size: String,
        format: String,
        language: [String],
        lastModified: Date,
        url: String,
        checksum: String
    },
    monitoring: {
        isActive: { type: Boolean, default: true },
        checkFrequency: { type: Number, default: 3600000 }, // 1 hour in ms
        notificationsSent: Number,
        lastNotificationDate: Date,
        updatePattern: String // regex pattern for detecting updates
    },
    status: {
        type: String,
        enum: ['active', 'paused', 'error', 'up-to-date', 'update-available'],
        default: 'active'
    }
});

// Compound index to ensure a user can't track the same game twice
trackedGameSchema.index({ gameId: 1, userId: 1 }, { unique: true });

// Indexes for efficient querying
trackedGameSchema.index({ status: 1 });
trackedGameSchema.index({ hasUpdates: 1 });
trackedGameSchema.index({ 'monitoring.isActive': 1 });
trackedGameSchema.index({ lastChecked: 1 });

// Methods for update detection
trackedGameSchema.methods.updateVersion = function(newVersion, changelog, metadata = {}) {
    if (this.currentVersion && this.currentVersion !== newVersion) {
        // Add to update history
        this.updateHistory.push({
            version: newVersion,
            changes: changelog,
            size: metadata.size,
            source: metadata.source
        });
        this.hasUpdates = true;
        this.status = 'update-available';
    }
    
    this.lastKnownVersion = this.currentVersion;
    this.currentVersion = newVersion;
    this.lastChecked = new Date();
    
    // Update metadata if provided
    if (metadata) {
        this.metadata = { ...this.metadata, ...metadata };
    }
    
    return this.save();
};

trackedGameSchema.methods.markAsChecked = function() {
    this.lastChecked = new Date();
    return this.save();
};

trackedGameSchema.methods.clearUpdates = function() {
    this.hasUpdates = false;
    this.status = 'up-to-date';
    return this.save();
};

// Static methods for querying
trackedGameSchema.statics.findPendingChecks = function() {
    const oneHourAgo = new Date(Date.now() - 3600000);
    return this.find({
        'monitoring.isActive': true,
        lastChecked: { $lt: oneHourAgo }
    });
};

trackedGameSchema.statics.findWithUpdates = function(userId = null) {
    const query = { hasUpdates: true };
    if (userId) query.userId = userId;
    return this.find(query);
};

const TrackedGame = mongoose.model('TrackedGame', trackedGameSchema);

export default TrackedGame;