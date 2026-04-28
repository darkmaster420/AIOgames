/**
 * Minimal undici dispatcher setup for game-source scraping.
 *
 * Important: we only override TCP connect timeout here.
 * We intentionally do NOT set headers/body timeouts globally, so per-request
 * AbortSignal.timeout in siteFetch() remains the single source of truth for
 * request duration limits.
 */

import { Agent, setGlobalDispatcher } from 'undici';

declare global {
  var __siteFetchDispatcherInstalled: boolean | undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const SITE_CONNECT_TIMEOUT_MS = parsePositiveInt(
  process.env.SITE_CONNECT_TIMEOUT_MS,
  60000
);

function installDispatcher(): void {
  if (globalThis.__siteFetchDispatcherInstalled) return;

  const agent = new Agent({
    connect: { timeout: SITE_CONNECT_TIMEOUT_MS },
  });

  setGlobalDispatcher(agent);
  globalThis.__siteFetchDispatcherInstalled = true;

  console.log(`[net] undici dispatcher installed (connectTimeout=${SITE_CONNECT_TIMEOUT_MS}ms)`);
}

installDispatcher();

export function ensureSiteFetchDispatcher(): void {
  installDispatcher();
}
