import webpush from 'web-push';
import fs from 'fs';
import path from 'path';

// In-memory storage for generated VAPID keys (for runtime generation)
let generatedKeys: { publicKey: string; privateKey: string } | null = null;

/**
 * Get VAPID keys, either from environment variables or generate them at runtime
 * This ensures VAPID keys are always available even in Docker containers
 */
export function getVapidKeys(): { publicKey: string; privateKey: string } {
  // First, try to get from environment variables
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  
  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate
    };
  }

  // If not in environment, try to read from .env.local (development)
  const envLocalPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envLocalPath)) {
    try {
      const envContents = fs.readFileSync(envLocalPath, 'utf8');
      const publicMatch = envContents.match(/^VAPID_PUBLIC_KEY=(.+)$/m);
      const privateMatch = envContents.match(/^VAPID_PRIVATE_KEY=(.+)$/m);
      
      if (publicMatch && privateMatch) {
        return {
          publicKey: publicMatch[1],
          privateKey: privateMatch[1]
        };
      }
    } catch {
      // Could not read .env.local file - continuing with environment variables  
    }
  }

  // If still not found, generate keys at runtime and cache them
  if (!generatedKeys) {
    // Generate runtime VAPID keys
    generatedKeys = webpush.generateVAPIDKeys();
  }

  return generatedKeys!; // We know it's not null at this point
}

/**
 * Configure web-push with VAPID keys
 * Call this once at application startup
 */
export function configureWebPush(): void {
  const { publicKey, privateKey } = getVapidKeys();
  
  webpush.setVapidDetails(
    'mailto:admin@aiogames.com',
    publicKey,
    privateKey
  );
}

/**
 * Get just the public VAPID key for client-side use
 */
export function getPublicVapidKey(): string {
  return getVapidKeys().publicKey;
}