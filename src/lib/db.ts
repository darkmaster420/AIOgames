import mongoose from 'mongoose';
import { ensureAdminExists } from './seedAdmin';
import logger from '../utils/logger';

const MONGODB_URI = process.env.MONGODB_URI;

declare global {
  var mongoose: {
    conn: typeof import('mongoose') | null;
    promise: Promise<typeof import('mongoose')> | null;
    adminSeeded: boolean;
  };
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null, adminSeeded: false };
}

// mongoose.connection.readyState values:
// 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
function isConnectionHealthy(): boolean {
  const state = mongoose.connection?.readyState;
  return state === 1 || state === 2;
}

async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
  }

  // If we think we're connected but the underlying connection has actually
  // dropped (network blip, Mongo restart, idle timeout, etc.), clear the
  // cache so we reconnect. Without this, `bufferCommands: false` means every
  // subsequent query fails with "before initial connection is complete".
  if (cached.conn && !isConnectionHealthy()) {
    logger.warn(`MongoDB connection unhealthy (readyState=${mongoose.connection?.readyState}), reconnecting...`);
    cached.conn = null;
    cached.promise = null;
  }

  if (cached.conn) {
    // Only seed admin once per application lifecycle
    if (!cached.adminSeeded) {
      cached.adminSeeded = true;
      // Run admin seeding in background to not block requests
      setTimeout(async () => {
        await ensureAdminExists();
      }, 1000);
    }
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then(async (mongoose) => {
      // Seed admin user after successful connection
      if (!cached.adminSeeded) {
        cached.adminSeeded = true;
        setTimeout(async () => {
          await ensureAdminExists();
        }, 1000);
      }
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
    // If connect() resolved but connection state isn't healthy (rare race),
    // treat this as a failure so the next call retries.
    if (!isConnectionHealthy()) {
      cached.conn = null;
      cached.promise = null;
      logger.error(`MongoDB connected but readyState=${mongoose.connection?.readyState}`);
      return null;
    }
  } catch (e) {
    cached.promise = null;
    logger.error('MongoDB connection error:', e);
    // Return null instead of throwing to allow graceful handling
    return null;
  }

  return cached.conn;
}

// One-time listeners to invalidate the cached connection if mongoose itself
// reports that the connection was lost. This ensures the next connectDB()
// call re-establishes the connection instead of returning a stale handle.
if (!(global as unknown as { __mongooseListenersAttached?: boolean }).__mongooseListenersAttached) {
  (global as unknown as { __mongooseListenersAttached?: boolean }).__mongooseListenersAttached = true;
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB connection event: disconnected');
    if (cached) {
      cached.conn = null;
      cached.promise = null;
    }
  });
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection event: error', err);
    if (cached) {
      cached.conn = null;
      cached.promise = null;
    }
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB connection event: reconnected');
  });
}

export default connectDB;