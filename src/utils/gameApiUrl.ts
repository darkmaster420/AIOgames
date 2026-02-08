/**
 * Get the correct GameAPI base URL for server-side requests
 * 
 * When GAME_API_URL is set, uses that (external API)
 * Otherwise, uses localhost to avoid proxy/auth issues with internal API
 */
export function getGameApiUrl(): string {
  if (process.env.GAME_API_URL) {
    // External API configured
    return process.env.GAME_API_URL;
  }
  
  // Internal API - use localhost for server-side requests to avoid proxy
  const protocol = 'http'; // Always http for internal Docker communication
  const host = process.env.HOSTNAME || 'localhost';
  const port = process.env.PORT || '3000';
  
  return `${protocol}://${host}:${port}/api/gameapi`;
}
