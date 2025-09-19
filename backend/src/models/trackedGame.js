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
    }
});

// Compound index to ensure a user can't track the same game twice
trackedGameSchema.index({ gameId: 1, userId: 1 }, { unique: true });

const TrackedGame = mongoose.model('TrackedGame', trackedGameSchema);

export default TrackedGame;