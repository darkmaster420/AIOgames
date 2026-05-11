/**
 * Minimal undici dispatcher setup for game-source scraping.
 *
 * Important: we only override TCP connect timeout here.
 * We intentionally do NOT set headers/body timeouts globally, so per-request
 * AbortSignal.timeout in siteFetch() remains the single source of truth for
 * request duration limits.
 *
 * On VPS hosts with broken or slow IPv6 routes, outbound `fetch()` can hang
 * until connect times out. We therefore prefer IPv4 for DNS ordering and,
 * unless disabled via `FORCE_IPV4=0`, force `family: 4` on sockets used by
 * this global undici Agent (Node's built-in `fetch`).
 */

import dns from 'node:dns';
import { Agent, setGlobalDispatcher } from 'undici';

declare global {
  var __siteFetchDispatcherInstalled: boolean | undefined;
  var __siteFetchNetworkPrefsInstalled: boolean | undefined;
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

/** When true (default), undici uses IPv4-only sockets for outbound fetch. */
export function shouldForceIpv4(): boolean {
  const v = (process.env.FORCE_IPV4 ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

function installNetworkPreferences(): void {
  if (globalThis.__siteFetchNetworkPrefsInstalled) return;
  globalThis.__siteFetchNetworkPrefsInstalled = true;
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    // Unsupported in some runtimes; ignore.
  }
}

function installDispatcher(): void {
  if (globalThis.__siteFetchDispatcherInstalled) return;

  installNetworkPreferences();

  const forceIpv4 = shouldForceIpv4();
  const connect: { timeout: number; family?: 4 } = {
    timeout: SITE_CONNECT_TIMEOUT_MS,
  };
  if (forceIpv4) {
    connect.family = 4;
  }

  const agent = new Agent({
    connect,
    ...(forceIpv4 ? { autoSelectFamily: false as const } : {}),
  });

  setGlobalDispatcher(agent);
  globalThis.__siteFetchDispatcherInstalled = true;

  console.log(
    `[net] undici dispatcher installed (connectTimeout=${SITE_CONNECT_TIMEOUT_MS}ms, forceIpv4=${forceIpv4})`
  );
}

installDispatcher();

export function ensureSiteFetchDispatcher(): void {
  installDispatcher();
}
