import bcrypt from 'bcryptjs';
import connectDB from './db';
import { User } from './models';
import logger from '../utils/logger';

export async function seedAdminUser() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME;

    if (!adminEmail || !adminPassword || !adminName) {
      const msg =
        'Admin seed skipped: set ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_NAME in .env (see .env.development.example). With no admin in the database, use POST /api/admin/seed from localhost in development after setting them.';
      console.warn('[AIOgames]', msg);
      logger.warn(msg);
      return false;
    }

    await connectDB();

    const emailKey = adminEmail.toLowerCase().trim();

    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: emailKey });
    if (existingAdmin) {
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        existingAdmin.name = adminName;
        existingAdmin.password = await bcrypt.hash(adminPassword, 12);
        await existingAdmin.save();
        console.log('[AIOgames]', `Admin seed: promoted existing user ${emailKey} to admin`);
        logger.info(`Admin seed: promoted existing user ${emailKey} to admin`);
        return true;
      }
      const matches = await bcrypt.compare(adminPassword, existingAdmin.password);
      if (!matches) {
        existingAdmin.password = await bcrypt.hash(adminPassword, 12);
        await existingAdmin.save();
        console.log('[AIOgames]', `Admin seed: refreshed password from ADMIN_PASSWORD for ${emailKey}`);
        logger.info(`Admin seed: refreshed password from ADMIN_PASSWORD for ${emailKey}`);
      }
      return true;
    }

    // Create new admin user
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const adminUser = new User({
      email: emailKey,
      password: hashedPassword,
      name: adminName,
      role: 'admin',
      createdAt: new Date(),
      preferences: {
        theme: 'system',
        notifications: {
          email: true,
          updates: true,
          security: true
        }
      }
    });

    await adminUser.save();
    console.log('[AIOgames]', `Admin seed: created admin user ${adminEmail}`);
    logger.info(`Admin seed: created admin user ${adminEmail}`);

    return true;
  } catch (error) {
    logger.error('Error seeding admin user:', error);
    return false;
  }
}

export async function ensureAdminExists() {
  try {
    await connectDB();
    
    // Check if any admin exists
    const adminCount = await User.countDocuments({ role: 'admin' });
    
    if (adminCount === 0) {
      return await seedAdminUser();
    }

    return true;
  } catch (error) {
    logger.error('Error checking for admin users:', error);
    return false;
  }
}