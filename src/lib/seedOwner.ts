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
      const msg =
        'OWNER_EMAIL and OWNER_PASSWORD not set in environment — skipping owner seed';
      console.log('[AIOgames]', msg);
      logger.info(`⚠️ ${msg}`);
      return;
    }

    await connectDB();

    const emailKey = ownerEmail.toLowerCase().trim();

    // Check if owner already exists
    const existingOwner = await User.findOne({ email: emailKey });

    if (existingOwner) {
      let dirty = false;
      if (existingOwner.role !== 'owner') {
        existingOwner.role = 'owner';
        dirty = true;
        logger.info(`✅ Updated existing user ${emailKey} to owner role`);
      }
      // Keep DB password in sync with OWNER_PASSWORD so .env changes / stale hashes don't cause 401 on login
      const matches = await bcrypt.compare(ownerPassword, existingOwner.password);
      if (!matches) {
        existingOwner.password = await bcrypt.hash(ownerPassword, 10);
        dirty = true;
        logger.info(`✅ Refreshed owner password from OWNER_PASSWORD for ${emailKey}`);
      }
      if (dirty) {
        await existingOwner.save();
      } else {
        logger.info(`✅ Owner user ${emailKey} already exists`);
      }
      return;
    }

    // Create new owner user
    const hashedPassword = await bcrypt.hash(ownerPassword, 10);

    const owner = new User({
      email: emailKey,
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
