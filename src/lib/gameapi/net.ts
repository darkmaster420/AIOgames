/**
 * Network / fetch configuration for game source scraping.
 *
 * The Node.js built-in `fetch` is powered by undici, and undici's default
 * TCP connect timeout is 10s. When any of the piracy/release sites we scrape
 * is slow to accept a connection (common for Cloudflare-fronted hosts like
 * skidrowreloaded.com, steamrip.com, dodi-repacks.download, online-fix.me,
 * freegogpcgames.com) we hit `UND_ERR_CONNECT_TIMEOUT` at 10_000ms no matter
 * what AbortSignal or per-request timeout we pass. Response timeouts cannot
 * override the connect timeout — only the dispatcher's `connectTimeout` can.
 *
 * To fix the symptom where searches silently fall back to "No results" after
 * only 10s, we install a global undici dispatcher with a 60s (configurable)
 * connect timeout. This applies to every `fetch()` call in the server-side
 * code paths that don't already pass an explicit `dispatcher`.
 *
 * Env overrides:
 *   SITE_CONNECT_TIMEOUT_MS  — TCP connect timeout (default 60_000)
 *   SITE_HEADERS_TIMEOUT_MS  — time to wait for response headers (default 60_000)
 *   SITE_BODY_TIMEOUT_MS     — time to wait for response body (default 60_000)
 *   SITE_KEEPALIVE_TIMEOUT_MS — idle keepalive cap (default 30_000)
 *
 * Uses a side-effecting module so the dispatcher is installed exactly once on
 * first import.
 */

import { Agent, setGlobalDispatcher } from 'undici';

declare global {
  // Track whether we've already installed the dispatcher in this process.
  // Next.js dev mode can evaluate server modules multiple times.
  var __siteFetchDispatcherInstalled: boolean | undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const SITE_CONNECT_TIMEOUT_MS = parsePositiveInt(process.env.SITE_CONNECT_TIMEOUT_MS, 60_000);
export const SITE_HEADERS_TIMEOUT_MS = parsePositiveInt(process.env.SITE_HEADERS_TIMEOUT_MS, 60_000);
export const SITE_BODY_TIMEOUT_MS = parsePositiveInt(process.env.SITE_BODY_TIMEOUT_MS, 60_000);
export const SITE_KEEPALIVE_TIMEOUT_MS = parsePositiveInt(process.env.SITE_KEEPALIVE_TIMEOUT_MS, 30_000);

function installDispatcher(): void {
  if (globalThis.__siteFetchDispatcherInstalled) return;

  const agent = new Agent({
    connect: {
      timeout: SITE_CONNECT_TIMEOUT_MS,
    },
    headersTimeout: SITE_HEADERS_TIMEOUT_MS,
    bodyTimeout: SITE_BODY_TIMEOUT_MS,
    keepAliveTimeout: SITE_KEEPALIVE_TIMEOUT_MS,
  });

  setGlobalDispatcher(agent);
  globalThis.__siteFetchDispatcherInstalled = true;

  console.log(
    `[net] undici global dispatcher installed: connectTimeout=${SITE_CONNECT_TIMEOUT_MS}ms, ` +
    `headersTimeout=${SITE_HEADERS_TIMEOUT_MS}ms, bodyTimeout=${SITE_BODY_TIMEOUT_MS}ms`
  );
}

installDispatcher();

/**
 * Ensures the dispatcher is installed. Call this from any module that issues
 * outbound fetches to the external game sites. Safe to call many times.
 */
export function ensureSiteFetchDispatcher(): void {
  installDispatcher();
}
