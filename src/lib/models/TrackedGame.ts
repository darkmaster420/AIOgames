import mongoose from 'mongoose';

const TrackedGameSchema = new mongoose.Schema({
  // Game identification
  gameId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  originalTitle: {
    type: String,
    required: true
  },
  source: {
    type: String,
    required: true,
    enum: ['SkidrowReloaded', 'FreeGOGPCGames', 'GameDrive', 'SteamRip']
  },
  
  // Version tracking
  lastKnownVersion: {
    type: String,
    default: ''
  },
  lastVersionDate: {
    type: Date
  },
  
  // Tracking metadata
  dateAdded: {
    type: Date,
    default: Date.now
  },
  lastChecked: {
    type: Date,
    default: Date.now
  },
  
  // Settings
  notificationsEnabled: {
    type: Boolean,
    default: true
  },
  checkFrequency: {
    type: String,
    enum: ['hourly', 'daily', 'weekly'],
    default: 'daily'
  },
  
  // Update history
  updateHistory: [{
    version: String,
    dateFound: {
      type: Date,
      default: Date.now
    },
    gameLink: String,
    downloadLinks: [{
      service: String,
      url: String,
      type: String
    }]
  }],
  
  // Current status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Additional game info
  image: String,
  description: String,
  gameLink: String
}, {
  timestamps: true
});

// Indexes for efficient queries
TrackedGameSchema.index({ source: 1, isActive: 1 });
TrackedGameSchema.index({ lastChecked: 1 });
TrackedGameSchema.index({ title: 'text', originalTitle: 'text' });

export const TrackedGame = mongoose.models.TrackedGame || mongoose.model('TrackedGame', TrackedGameSchema);