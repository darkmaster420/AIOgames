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

  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  try {
    const { getLocalProfile } = await import('./lib/localProfile');
    await getLocalProfile();
    console.log('[AIOgames] Startup: shared local profile ready.');
  } catch (e) {
    console.error('[AIOgames] Startup: shared local profile initialization failed:', e);
  }
}
