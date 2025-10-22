import connectDB from './db';
import { User } from './models';
import logger from '../utils/logger';
import bcrypt from 'bcryptjs';

/**
 * Seed the owner user from environment variables
 * Runs at application startup
 */
export async function seedOwner(): Promise<void> {
  try {
    const ownerEmail = process.env.OWNER_EMAIL;
    const ownerPassword = process.env.OWNER_PASSWORD;
    const ownerName = process.env.OWNER_NAME || 'Owner';

    if (!ownerEmail || !ownerPassword) {
      logger.info('⚠️ OWNER_EMAIL and OWNER_PASSWORD not set in environment - skipping owner seed');
      return;
    }

    await connectDB();

    // Check if owner already exists
    const existingOwner = await User.findOne({ email: ownerEmail });

    if (existingOwner) {
      // Update to owner role if not already
      if (existingOwner.role !== 'owner') {
        existingOwner.role = 'owner';
        await existingOwner.save();
        logger.info(`✅ Updated existing user ${ownerEmail} to owner role`);
      } else {
        logger.info(`✅ Owner user ${ownerEmail} already exists`);
      }
      return;
    }

    // Create new owner user
    const hashedPassword = await bcrypt.hash(ownerPassword, 10);

    const owner = new User({
      email: ownerEmail,
      password: hashedPassword,
      name: ownerName,
      role: 'owner',
      emailVerified: new Date(), // Auto-verify owner
      preferences: {
        notifications: {
          email: true,
          provider: 'email',
          notifyImmediately: true
        }
      }
    });

    await owner.save();
    logger.info(`✅ Owner user created: ${ownerEmail}`);
    logger.info(`🔑 Owner can manage all users and assign admin roles`);

  } catch (error) {
    logger.error('❌ Error seeding owner:', error);
  }
}

/**
 * Check if a user is the owner
 */
export async function isOwner(userId: string): Promise<boolean> {
  try {
    await connectDB();
    const user = await User.findById(userId);
    return user?.role === 'owner';
  } catch {
    return false;
  }
}

/**
 * Check if a user is admin or owner
 */
export async function isAdminOrOwner(userId: string): Promise<boolean> {
  try {
    await connectDB();
    const user = await User.findById(userId);
    return user?.role === 'admin' || user?.role === 'owner';
  } catch {
    return false;
  }
}
