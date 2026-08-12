import connectDB from './db';
import { User } from './models';

type LocalProfile = {
  id: string;
  email: string;
  name: string;
  username?: string;
  role: 'owner';
};

let profilePromise: Promise<LocalProfile> | null = null;

async function resolveLocalProfile(): Promise<LocalProfile> {
  await connectDB();

  const configuredEmail = (process.env.LOCAL_PROFILE_EMAIL || '').trim().toLowerCase();
  let user = configuredEmail ? await User.findOne({ email: configuredEmail }) : null;
  user ||= await User.findOne({ role: 'owner', banned: { $ne: true } }).sort({ createdAt: 1 });
  user ||= await User.findOne({ role: 'admin', banned: { $ne: true } }).sort({ createdAt: 1 });
  user ||= await User.findOne({ banned: { $ne: true } }).sort({ createdAt: 1 });

  if (!user) {
    user = await User.create({
      email: configuredEmail || 'local@aiogames.invalid',
      password: 'offline-profile-disabled',
      name: 'Local Library',
      username: 'local',
      role: 'owner',
    });
  } else if (user.role !== 'owner') {
    user.role = 'owner';
    await user.save();
  }

  return {
    id: String(user._id),
    email: user.email,
    name: user.name || 'Local Library',
    username: user.username || undefined,
    role: 'owner',
  };
}

/** Internal compatibility identity for the single NAS-wide library. */
export function getLocalProfile(): Promise<LocalProfile> {
  profilePromise ||= resolveLocalProfile().catch(error => {
    profilePromise = null;
    throw error;
  });
  return profilePromise;
}

