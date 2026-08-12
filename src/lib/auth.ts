import { getLocalProfile } from './localProfile';

export async function getCurrentUser() {
  try {
    return await getLocalProfile();
  } catch (error) {
    console.error('Error loading local library profile:', error);
    return null;
  }
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}
