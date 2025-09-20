import mongoose from 'mongoose';
import { ensureAdminExists } from './seedAdmin';

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

async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
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
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectDB;