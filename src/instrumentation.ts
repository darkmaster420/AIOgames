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

  // Root layout `import './init'` is not guaranteed to run at process boot in dev;
  // seed owner/admin here so Mongo users are created reliably and logs appear in this terminal.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  try {
    console.log('[AIOgames] Startup: running owner/admin DB seed (if env is configured)...');
    const { seedOwner } = await import('./lib/seedOwner');
    const { ensureAdminExists } = await import('./lib/seedAdmin');
    await seedOwner();
    await ensureAdminExists();
    console.log('[AIOgames] Startup: owner/admin seed step finished.');
  } catch (e) {
    console.error('[AIOgames] Startup: owner/admin seed failed:', e);
  }
}
