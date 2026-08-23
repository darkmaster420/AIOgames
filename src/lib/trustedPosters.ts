/**
 * Runtime source of truth for cs.rin.ru poster reputation.
 *
 * Two lists drive how forum posts are ranked: trusted uploaders float to the
 * top of the candidate pool, untrusted ones sink to the bottom. Both used to
 * live only in env vars (CSRIN_RELIABLE_POSTERS / CSRIN_UNTRUSTED_POSTERS), so
 * a change meant editing the environment and restarting. They are now stored in
 * the AppSetting collection and editable from the admin UI, with the env vars
 * kept as an always-applied, non-removable baseline.
 *
 * The scraping layer (lib/gameapi/helpers.js) stays database-free and exposes
 * only synchronous setters. This module owns the database read and pushes the
 * merged lists in, refreshing at most once per REFRESH_TTL_MS.
 */

import connectDB from './db';
import { AppSetting } from './models';
import { setCsrinReliablePosters, setCsrinUntrustedPosters } from './gameapi/helpers.js';

export const TRUSTED_POSTERS_KEY = 'csrinReliablePosters';
export const UNTRUSTED_POSTERS_KEY = 'csrinUntrustedPosters';
const REFRESH_TTL_MS = 60 * 1000;

type PosterKind = 'trusted' | 'untrusted';

const CONFIG: Record<PosterKind, { storageKey: string; envVar: string; apply: (names: string[]) => void }> = {
  trusted: { storageKey: TRUSTED_POSTERS_KEY, envVar: 'CSRIN_RELIABLE_POSTERS', apply: setCsrinReliablePosters },
  untrusted: { storageKey: UNTRUSTED_POSTERS_KEY, envVar: 'CSRIN_UNTRUSTED_POSTERS', apply: setCsrinUntrustedPosters },
};

let lastRefreshedAt = 0;
let refreshInFlight: Promise<void> | null = null;

function dedupeCaseInsensitive(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Names hard-coded via the env var for this kind. Always applied, non-removable. */
export function getEnvPosters(kind: PosterKind): string[] {
  return dedupeCaseInsensitive((process.env[CONFIG[kind].envVar] || '').split(','));
}

/** The names stored in the database (i.e. added through the admin UI). */
export async function getStoredPosters(kind: PosterKind): Promise<string[]> {
  await connectDB();
  const doc = await AppSetting.findOne({ key: CONFIG[kind].storageKey }).lean<{ value?: unknown } | null>();
  const value = doc?.value;
  if (!Array.isArray(value)) return [];
  return dedupeCaseInsensitive(value.map(v => String(v || '')));
}

/** Env baseline plus stored names, deduped — the effective list for this kind. */
export async function getEffectivePosters(kind: PosterKind): Promise<string[]> {
  const stored = await getStoredPosters(kind);
  return dedupeCaseInsensitive([...getEnvPosters(kind), ...stored]);
}

/** Replaces the stored list for one kind, then re-applies both to the scraper. */
export async function saveStoredPosters(kind: PosterKind, names: string[]): Promise<string[]> {
  await connectDB();
  const cleaned = dedupeCaseInsensitive(names);
  await AppSetting.updateOne(
    { key: CONFIG[kind].storageKey },
    { $set: { value: cleaned } },
    { upsert: true },
  );
  await refreshTrustedPostersCache(true);
  return cleaned;
}

/**
 * Pushes both effective lists into the scraper, at most once per TTL. Safe to
 * call before every search: concurrent callers share one in-flight refresh, and
 * a database failure leaves whatever sets are already loaded in place.
 */
export async function refreshTrustedPostersCache(force = false): Promise<void> {
  if (!force && Date.now() - lastRefreshedAt < REFRESH_TTL_MS) return;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const [trusted, untrusted] = await Promise.all([
        getEffectivePosters('trusted'),
        getEffectivePosters('untrusted'),
      ]);
      setCsrinReliablePosters(trusted);
      setCsrinUntrustedPosters(untrusted);
      lastRefreshedAt = Date.now();
    } catch (error) {
      console.warn('Could not refresh cs.rin.ru poster reputation:', error);
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}
