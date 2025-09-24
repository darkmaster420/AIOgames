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
    } catch (error) {
      console.warn('Could not read .env.local file:', error);
    }
  }

  // If still not found, generate keys at runtime and cache them
  if (!generatedKeys) {
    console.log('🔐 No VAPID keys found in environment or .env.local. Generating runtime keys...');
    generatedKeys = webpush.generateVAPIDKeys();
    console.log('✅ VAPID keys generated at runtime');
    console.log('⚠️  Note: These keys will be regenerated on each container restart.');
    console.log('⚠️  For production, set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.');
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
  
  console.log('📧 Web push configured with VAPID keys');
}

/**
 * Get just the public VAPID key for client-side use
 */
export function getPublicVapidKey(): string {
  return getVapidKeys().publicKey;
}