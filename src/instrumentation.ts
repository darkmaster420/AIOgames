/**
 * Runs once when the Node server starts (not in Edge).
 * Ensures outbound `fetch()` uses our undici dispatcher (IPv4 + connect
 * timeout) before any route handles traffic.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }
  await import('./lib/gameapi/net');
}
