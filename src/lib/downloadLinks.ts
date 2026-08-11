/**
 * Single source of truth for download-link shaping.
 *
 * Two things used to go wrong and are both handled here:
 *
 * 1. Mongoose subdocuments. Stored links live in `updateHistory[].downloadLinks`,
 *    `latestApprovedUpdate.downloadLinks` and `rssCachedDownloadLinks`. When those
 *    come off a *hydrated* document they are subdocuments, and `{ ...subdoc }`
 *    copies internal state (`$__`, `_doc`, `__parentArray`) rather than the
 *    schema paths — the resulting objects have no `url`/`service` at all. Always
 *    read the fields explicitly so both hydrated and lean shapes work.
 *
 * 2. Duplicates. The same URL is routinely stored in more than one place (an
 *    update writes `latestApprovedUpdate`, pushes an `updateHistory` row and
 *    refreshes `rssCachedDownloadLinks` with the same array), and scrapers can
 *    emit one URL twice under different service labels. Dedupe on the URL.
 */

export type DownloadLinkLike = {
  service?: unknown;
  url?: unknown;
  type?: unknown;
};

export type NormalizedDownloadLink = {
  service: string;
  url: string;
  type: string;
};

export type DisplayDownloadLink = NormalizedDownloadLink & {
  displayName: string;
  icon: string;
};

const SERVICE_NAMES: Record<string, string> = {
  '1fichier': '1fichier',
  dailyuploads: 'DailyUploads',
  datanodes: 'DataNodes',
  direct: 'Direct Download',
  gofile: 'Gofile',
  googledrive: 'Google Drive',
  hitfile: 'HitFile',
  katfile: 'Katfile',
  krakenfiles: 'KrakenFiles',
  magnet: 'Magnet Link',
  mediafire: 'MediaFire',
  mega: 'MEGA',
  multiup: 'MultiUp',
  nitroflare: 'Nitroflare',
  pixeldrain: 'Pixeldrain',
  rapidgator: 'RapidGator',
  torrent: 'Torrent',
  turbobit: 'Turbobit',
  uploadhaven: 'UploadHaven',
};

const SERVICE_ICONS: Record<string, string> = {
  '1fichier': '📄',
  dailyuploads: '📤',
  datanodes: '🗄️',
  direct: '⬇️',
  gofile: '📁',
  googledrive: '📁',
  hitfile: '🎯',
  katfile: '🐱',
  krakenfiles: '🐙',
  magnet: '🧲',
  mediafire: '🔥',
  mega: '☁️',
  multiup: '📦',
  nitroflare: '🔥',
  pixeldrain: '💧',
  rapidgator: '⚡',
  torrent: '🌊',
  turbobit: '⚡',
  uploadhaven: '📤',
};

/** Display label for a service key. Falls back to capitalising the raw value. */
export function formatServiceName(service: string | null | undefined): string {
  const raw = typeof service === 'string' ? service.trim() : '';
  if (!raw) return 'Download';
  return SERVICE_NAMES[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Emoji shown next to a link. Generic link icon for anything unrecognised. */
export function getServiceIcon(service: string | null | undefined): string {
  const raw = typeof service === 'string' ? service.trim().toLowerCase() : '';
  if (!raw) return '🔗';
  return SERVICE_ICONS[raw] || '🔗';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Dedupe key for a URL. Magnet links are compared on their btih hash so the
 * same torrent added with different trackers/display names collapses to one
 * entry; everything else compares case-insensitively with trailing slashes
 * and a trailing `?`/`#` ignored.
 */
function dedupeKey(url: string): string {
  const lower = url.toLowerCase();

  const btih = lower.match(/xt=urn:btih:([a-z0-9]+)/);
  if (btih) return `magnet:${btih[1]}`;

  return lower.replace(/[?#]$/, '').replace(/\/+$/, '');
}

/**
 * Normalise an arbitrary link list into plain, deduped objects.
 *
 * Reads every field explicitly (never spreads) so mongoose subdocuments survive,
 * drops entries with no URL, and keeps the first occurrence of each URL — except
 * that a later entry with a real service label upgrades an earlier generic one,
 * since the order links arrive in doesn't correlate with label quality.
 */
export function normalizeDownloadLinks(
  links: readonly DownloadLinkLike[] | null | undefined,
): NormalizedDownloadLink[] {
  if (!Array.isArray(links)) return [];

  const byKey = new Map<string, NormalizedDownloadLink>();

  for (const link of links) {
    if (!link || typeof link !== 'object') continue;

    const url = readString(link.url);
    if (!url) continue;

    const service = readString(link.service);
    const type = readString(link.type);
    const key = dedupeKey(url);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        service: service || 'download',
        url,
        type: type || 'download',
      });
      continue;
    }

    // Upgrade placeholder metadata from a duplicate that knows more.
    if (existing.service === 'download' && service) existing.service = service;
    if (existing.type === 'download' && type) existing.type = type;
  }

  return Array.from(byKey.values());
}

/** Normalise and attach the presentation fields the UI renders. */
export function toDisplayDownloadLinks(
  links: readonly DownloadLinkLike[] | null | undefined,
): DisplayDownloadLink[] {
  return normalizeDownloadLinks(links).map(link => ({
    ...link,
    displayName: formatServiceName(link.service),
    icon: getServiceIcon(link.service),
  }));
}
