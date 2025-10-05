import mongoose from 'mongoose';

// User Schema
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: false,
    unique: true,
    sparse: true, // allow existing users without username
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 24,
    validate: {
      validator: function(v: string) {
        if (!v) return true; // optional
        return /^[a-z0-9_]+$/.test(v);
      },
      message: 'Username can only contain lowercase letters, numbers, and underscores'
    }
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function(v: string) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  },
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      provider: {
        type: String,
        enum: ['email', 'webpush', 'telegram'],
        default: 'webpush'
      },
      webpushEnabled: {
        type: Boolean,
        default: true
      },
      telegramEnabled: {
        type: Boolean,
        default: false
      },
      telegramBotToken: {
        type: String,
        default: ''
      },
      telegramChatId: {
        type: String,
        default: ''
      },
      notifyImmediately: {
        type: Boolean,
        default: true
      },
      updateFrequency: {
        type: String,
        enum: ['immediate', 'daily', 'weekly'],
        default: 'daily'
      }
    },
    sequelDetection: {
      enabled: {
        type: Boolean,
        default: true
      },
      sensitivity: {
        type: String,
        enum: ['strict', 'moderate', 'loose'],
        default: 'moderate'
      },
      notifyImmediately: {
        type: Boolean,
        default: true
      }
    },
    aiDetection: {
      enabled: {
        type: Boolean,
        default: true
      },
      autoApprovalThreshold: {
        type: Number,
        min: 0.5,
        max: 1.0,
        default: 0.8
      },
      fallbackToRegex: {
        type: Boolean,
        default: true
      },
      debugLogging: {
        type: Boolean,
        default: false
      }
    }
  },
  pushSubscriptions: [{
    endpoint: String,
    keys: {
      p256dh: String,
      auth: String
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// TrackedGame Schema - Updated to include user association
const trackedGameSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  gameId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  originalTitle: {
    type: String
  },
  source: {
    type: String,
    required: true
  },
  image: {
    type: String
  },
  description: {
    type: String
  },
  gameLink: {
    type: String,
    required: true
  },
  lastKnownVersion: {
    type: String,
    default: ''
  },
  lastVersionDate: {
    type: String
  },
  dateAdded: {
    type: Date,
    default: Date.now
  },
  lastChecked: {
    type: Date,
    default: Date.now
  },
  notificationsEnabled: {
    type: Boolean,
    default: true
  },
  checkFrequency: {
    type: String,
    enum: ['hourly', 'daily', 'weekly', 'manual'],
    default: 'daily'
  },
  steamVerified: {
    type: Boolean,
    default: false
  },
  steamAppId: {
    type: Number,
    default: null
  },
  steamName: {
    type: String,
    default: null
  },
  // Build number verification (manual SteamDB input)
  buildNumberVerified: {
    type: Boolean,
    default: false
  },
  currentBuildNumber: {
    type: String,
    default: ''
  },
  buildNumberSource: {
    type: String, // 'steamdb' for manual verification
    default: ''
  },
  buildNumberLastUpdated: {
    type: Date
  },
  buildNumberVerifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Version number verification (manual version input like v1.2.3)
  versionNumberVerified: {
    type: Boolean,
    default: false
  },
  currentVersionNumber: {
    type: String,
    default: ''
  },
  versionNumberSource: {
    type: String, // 'manual', 'steam', 'official', etc.
    default: ''
  },
  versionNumberLastUpdated: {
    type: Date
  },
  versionNumberVerifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Automatic version/build detection from title
  detectedVersion: {
    type: String,
    default: ''
  },
  detectedBuild: {
    type: String,
    default: ''
  },
  isDateVersion: {
    type: Boolean,
    default: false
  },
  isDateBasedBuild: {
    type: Boolean,
    default: false
  },
  versionDetectionDate: {
    type: Date
  },
  buildDetectionDate: {
    type: Date
  },
  
  updateHistory: [{
    version: {
      type: String,
      required: true
    },
    build: String,
    releaseType: String,
    updateType: String,
    changeType: String,
    significance: Number,
    dateFound: {
      type: Date,
      default: Date.now
    },
    gameLink: String,
    previousVersion: String,
    confirmedByUser: Boolean,
    originalReason: String,
    isLatest: {
      type: Boolean,
      default: false
    },
    // AI Detection Enhancement Fields
    aiDetectionConfidence: {
      type: Number,
      min: 0,
      max: 1
    },
    aiDetectionReason: String,
    detectionMethod: {
      type: String,
      enum: ['regex_only', 'ai_enhanced', 'ai_primary'],
      default: 'regex_only'
    },
    downloadLinks: [{
      service: {
        type: String,
        required: true
      },
      url: {
        type: String,
        required: true
      },
      type: {
        type: String,
        default: 'download'
      }
    }]
  }],
  latestApprovedUpdate: {
    version: String,
    dateFound: {
      type: Date,
      default: Date.now
    },
    gameLink: String,
    downloadLinks: [{
      service: {
        type: String,
        required: true
      },
      url: {
        type: String,
        required: true
      },
      type: {
        type: String,
        default: 'download'
      }
    }]
  },
  pendingUpdates: [{
    detectedVersion: {
      type: String,
      default: ''
    },
    build: {
      type: String,
      default: ''
    },
    releaseType: {
      type: String,
      default: ''
    },
    updateType: {
      type: String,
      default: ''
    },
    sceneGroup: {
      type: String,
      default: ''
    },
    newTitle: {
      type: String,
      required: true
    },
    newLink: {
      type: String,
      required: true
    },
    newImage: {
      type: String,
      default: ''
    },
    dateFound: {
      type: Date,
      default: Date.now
    },
    confidence: {
      type: Number,
      default: 0
    },
    reason: {
      type: String,
      default: 'Needs manual confirmation'
    },
    // AI Detection Enhancement Fields
    aiDetectionConfidence: {
      type: Number,
      min: 0,
      max: 1
    },
    aiDetectionReason: String,
    detectionMethod: {
      type: String,
      enum: ['regex_only', 'ai_enhanced', 'ai_primary'],
      default: 'regex_only'
    },
    downloadLinks: [{
      service: {
        type: String,
        required: true
      },
      url: {
        type: String,
        required: true
      },
      type: {
        type: String,
        default: 'download'
      }
    }]
  }],
  sequelNotifications: [{
    detectedTitle: {
      type: String,
      required: true
    },
    gameId: {
      type: String,
      required: true
    },
    gameLink: {
      type: String,
      required: true
    },
    image: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      default: ''
    },
    source: {
      type: String,
      required: true
    },
    similarity: {
      type: Number,
      required: true,
      min: 0,
      max: 1
    },
    sequelType: {
      type: String,
      enum: ['numbered_sequel', 'named_sequel', 'expansion', 'remaster', 'definitive'],
      required: true
    },
    dateFound: {
      type: Date,
      default: Date.now
    },
    isRead: {
      type: Boolean,
      default: false
    },
    isConfirmed: {
      type: Boolean,
      default: false
    },
    downloadLinks: [{
      service: {
        type: String,
        required: true
      },
      url: {
        type: String,
        required: true
      },
      type: {
        type: String,
        default: 'download'
      }
    }]
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  hasNewUpdate: {
    type: Boolean,
    default: false
  },
  newUpdateSeen: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
trackedGameSchema.index({ userId: 1, gameId: 1 }, { unique: true });
trackedGameSchema.index({ userId: 1, isActive: 1 });
trackedGameSchema.index({ source: 1, isActive: 1 });
trackedGameSchema.index({ lastChecked: 1 });
trackedGameSchema.index({ title: 'text', originalTitle: 'text' });

// Release Group Variants Schema - For collecting multiple release groups of the same game
const releaseGroupVariantSchema = new mongoose.Schema({
  trackedGameId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrackedGame',
    required: true,
    index: true
  },
  gameId: {
    type: String,
    required: true // Original gameId from the source site
  },
  releaseGroup: {
    type: String,
    required: true // e.g., 'GOG', 'P2P', 'CODEX', 'SKIDROW', 'REPACK'
  },
  source: {
    type: String,
    required: true // e.g., 'skidrow', 'gamedrive'
  },
  title: {
    type: String,
    required: true
  },
  gameLink: {
    type: String,
    required: true
  },
  version: {
    type: String // Detected version for this release group
  },
  buildNumber: {
    type: String // Detected build number for this release group
  },
  dateFound: {
    type: Date,
    default: Date.now
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for release group variants
releaseGroupVariantSchema.index({ trackedGameId: 1, releaseGroup: 1 });
releaseGroupVariantSchema.index({ gameId: 1 });
releaseGroupVariantSchema.index({ source: 1, isActive: 1 });

// Create and export models
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const TrackedGame = mongoose.models.TrackedGame || mongoose.model('TrackedGame', trackedGameSchema);
export const ReleaseGroupVariant = mongoose.models.ReleaseGroupVariant || mongoose.model('ReleaseGroupVariant', releaseGroupVariantSchema);