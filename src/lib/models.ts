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
        // Allow single-label hosts (e.g. owner@localhost) for local dev, plus normal domains
        return /^[^\s@]+@[^\s@]+(?:\.[^\s@]+)*$/.test(v);
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
    enum: ['user', 'admin', 'owner'],
    default: 'user'
  },
  banned: {
    type: Boolean,
    default: false
  },
  bannedReason: {
    type: String,
    default: ''
  },
  bannedAt: {
    type: Date
  },
  bannedBy: {
    type: String // User ID of admin who banned
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
      telegramUsername: {
        type: String,
        default: ''
      },
      telegramChatId: {
        type: String,
        default: ''
      },
      telegramUserId: {
        type: String,
        default: ''
      },
      telegramBotManagementEnabled: {
        type: Boolean,
        default: false
      },
      notifyImmediately: {
        type: Boolean,
        default: true
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
    },
    homepage: {
      showRecentUploads: {
        type: Boolean,
        default: false
      },
      showAllGames: {
        type: Boolean,
        default: false
      },
      layoutMode: {
        type: String,
        enum: ['grid', 'horizontal'],
        default: 'grid'
      },
      customCols: {
        type: mongoose.Schema.Types.Mixed,
        default: 'auto'
      },
      customRows: {
        type: mongoose.Schema.Types.Mixed,
        default: 'auto'
      }
    },
    tracking: {
      layoutMode: {
        type: String,
        enum: ['grid', 'horizontal'],
        default: 'grid'
      },
      customCols: {
        type: mongoose.Schema.Types.Mixed,
        default: 'auto'
      },
      customRows: {
        type: mongoose.Schema.Types.Mixed,
        default: 'auto'
      }
    },
    releaseGroups: {
      prioritize0xdeadcode: {
        type: Boolean,
        default: false
      },
      prefer0xdeadcodeForOnlineFixes: {
        type: Boolean,
        default: true
      },
      avoidRepacks: {
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
  },
  rssFeedToken: {
    type: String,
    default: null,
    sparse: true,
    index: true
  },
  rssFeedTokenCreatedAt: {
    type: Date
  },
  /** Newest-first snapshots from successful Telegram update notifications (RSS + prod-friendly links). */
  rssTelegramFeed: [
    {
      sentAt: { type: Date, default: Date.now },
      gameTitle: { type: String, default: '' },
      displayTitle: { type: String, default: '' },
      version: { type: String, default: '' },
      updateType: {
        type: String,
        enum: ['update', 'sequel'],
        default: 'update',
      },
      gameLink: { type: String, default: '' },
      imageUrl: { type: String, default: '' },
      source: { type: String, default: '' },
      previousVersion: { type: String, default: '' },
      downloadLinks: [
        {
          service: { type: String, required: true },
          url: { type: String, required: true },
          type: { type: String, default: 'download' },
        },
      ],
      trackedGameId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TrackedGame',
        required: false,
      },
    },
  ],
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
  lastPubTimestamp: {
    type: Number,
    default: 0
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
  
  // GOG verification
  gogVerified: {
    type: Boolean,
    default: false
  },
  gogProductId: {
    type: Number,
    default: null
  },
  gogName: {
    type: String,
    default: null
  },
  gogVersion: {
    type: String,
    default: null
  },
  gogBuildId: {
    type: String,
    default: null
  },
  gogLastChecked: {
    type: Date
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
    isOnlineFix: {
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
    }],
    notificationSent: {
      type: Boolean,
      default: false
    }
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
  /** Snapshot for RSS readers — filled when games are added/updated (avoids scraping on every RSS fetch). */
  rssCachedDownloadLinks: [{
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
  }],
  rssDownloadLinksFetchedAt: {
    type: Date
  },
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
  },
  sequelSource: {
    originalGameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TrackedGame'
    },
    originalGameTitle: {
      type: String
    },
    detectionMethod: {
      type: String,
      enum: ['automatic', 'manual'],
      default: 'automatic'
    },
    similarity: {
      type: Number
    },
    sequelType: {
      type: String
    }
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

// GOG Version Cache Schema - for caching GOG version data to avoid repeated API calls
const gogVersionCacheSchema = new mongoose.Schema({
  productId: {
    type: Number,
    required: true
  },
  os: {
    type: String,
    enum: ['windows', 'mac', 'linux'],
    required: true,
    default: 'windows'
  },
  version: {
    type: String
  },
  buildId: {
    type: String
  },
  date: {
    type: String
  },
  cachedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
    // index removed - using schema.index() below instead to avoid duplicate
  }
}, {
  timestamps: false
});

// Compound index for quick lookups
gogVersionCacheSchema.index({ productId: 1, os: 1 }, { unique: true });
// TTL index to automatically remove expired documents
gogVersionCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const libraryGameSchema = new mongoose.Schema({
  filePath: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  fileName: {
    type: String,
    required: true
  },
  relativePath: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  normalizedTitle: {
    type: String,
    required: true,
    index: true
  },
  extension: {
    type: String,
    required: true
  },
  fileSizeBytes: {
    type: Number,
    default: null
  },
  mtimeMs: {
    type: Number,
    required: true
  },
  contentKey: {
    type: String,
    required: true
  },
  lastSeenAt: {
    type: Date,
    required: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

libraryGameSchema.index({ normalizedTitle: 1, isActive: 1 });

const libraryScanJobSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['running', 'completed', 'failed'],
    required: true,
    index: true
  },
  startedAt: {
    type: Date,
    required: true,
    index: true
  },
  completedAt: {
    type: Date
  },
  filesSeen: {
    type: Number,
    default: 0
  },
  gamesUpserted: {
    type: Number,
    default: 0
  },
  gamesSkipped: {
    type: Number,
    default: 0
  },
  gamesRemoved: {
    type: Number,
    default: 0
  },
  errorCount: {
    type: Number,
    default: 0
  },
  message: {
    type: String,
    default: ''
  }
}, {
  timestamps: false
});

// Create and export models
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const TrackedGame = mongoose.models.TrackedGame || mongoose.model('TrackedGame', trackedGameSchema);
export const GOGVersionCache = mongoose.models.GOGVersionCache || mongoose.model('GOGVersionCache', gogVersionCacheSchema);
export const LibraryGame = mongoose.models.LibraryGame || mongoose.model('LibraryGame', libraryGameSchema);
export const LibraryScanJob = mongoose.models.LibraryScanJob || mongoose.model('LibraryScanJob', libraryScanJobSchema);
