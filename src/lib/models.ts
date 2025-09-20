import mongoose from 'mongoose';

// User Schema
const userSchema = new mongoose.Schema({
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
    }
  },
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
  updateHistory: [{
    version: {
      type: String,
      required: true
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
    changeType: {
      type: String,
      enum: ['version', 'build', 'release_type', 'update_type', 'different_link', 'unknown'],
      default: 'unknown'
    },
    significance: {
      type: Number,
      min: 0,
      max: 3,
      default: 1
    },
    dateFound: {
      type: Date,
      required: true
    },
    gameLink: {
      type: String,
      required: true
    },
    previousVersion: {
      type: String,
      default: ''
    },
    versionDetails: {
      old: {
        version: String,
        build: String,
        releaseType: String,
        updateType: String
      },
      new: {
        version: String,
        build: String,
        releaseType: String,
        updateType: String
      }
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

// Create and export models
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const TrackedGame = mongoose.models.TrackedGame || mongoose.model('TrackedGame', trackedGameSchema);