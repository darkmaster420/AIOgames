import bcrypt from 'bcryptjs';
import connectDB from './db';
import { User } from './models';

export async function seedAdminUser() {
  try {
    // Only run in development or if explicitly enabled
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME;

    if (!adminEmail || !adminPassword || !adminName) {
      // Admin user environment variables not set, skipping admin seeding
      return false;
    }

    await connectDB();

    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      // If user exists but isn't admin, promote them
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        await existingAdmin.save();
        // Promoted existing user to admin
        return true;
      } else {
        // Admin user already exists
        return true;
      }
    }

    // Create new admin user
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    
    const adminUser = new User({
      email: adminEmail,
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
    // Admin user created successfully
    
    return true;
  } catch (error) {
    console.error('❌ Error seeding admin user:', error);
    return false;
  }
}

export async function ensureAdminExists() {
  try {
    await connectDB();
    
    // Check if any admin exists
    const adminCount = await User.countDocuments({ role: 'admin' });
    
    if (adminCount === 0) {
      // No admin users found, attempting to seed admin user
      return await seedAdminUser();
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error checking for admin users:', error);
    return false;
  }
}