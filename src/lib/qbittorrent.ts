/**
 * Minimal qBittorrent WebUI API client for handing torrents/magnets off to a
 * qBittorrent instance on the same network (same pattern as FlareSolverr).
 *
 * Two things about the WebUI API are easy to get wrong and are handled here:
 *
 *  - CSRF. qBittorrent rejects POSTs whose `Referer`/`Origin` do not match the
 *    WebUI address, with a bare 403 and no explanation. Both headers are sent.
 *  - Sessions. `/auth/login` returns an `SID` cookie rather than a token, and
 *    it expires. The cookie is cached and a single retry re-authenticates when
 *    a call comes back 403, so a stale session self-heals.
 *
 * Credentials come from the environment and are never logged.
 */

import logger from '../utils/logger';
import { isTorrentUrl } from './downloadLinks';

export { isTorrentUrl };

export type QbitAddParams = {
  /** magnet: URI or http(s) URL of a .torrent file. */
  url: string;
  /** Used for the auto-tag when enabled; not sent as the torrent name. */
  gameTitle?: string;
  category?: string;
  tags?: string[];
  savePath?: string;
  paused?: boolean;
};

export type QbitResult = {
  ok: boolean;
  /** 'added' | 'disabled' | 'auth' | 'rejected' | 'unreachable' */
  outcome: 'added' | 'disabled' | 'auth' | 'rejected' | 'unreachable';
  message: string;
  category?: string;
  tags?: string[];
};

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** Base WebUI URL with any trailing slash removed, or '' when unconfigured. */
export function getQbitBaseUrl(): string {
  const raw = (process.env.QBITTORRENT_URL || process.env.QBIT_URL || '').trim();
  return raw.replace(/\/+$/, '');
}

export function isQbitConfigured(): boolean {
  return Boolean(getQbitBaseUrl());
}

export function getQbitCategory(): string {
  return (process.env.QBIT_CATEGORY || 'games').trim();
}

/**
 * Tags applied to every torrent. Commas delimit tags in the API, so they are
 * stripped from any individual tag rather than silently splitting it in two.
 */
export function getQbitTags(gameTitle?: string): string[] {
  const configured = (process.env.QBIT_TAGS ?? 'aiogames')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  const tags = [...configured];

  if (envFlag('QBIT_TAG_GAME_TITLE', true) && gameTitle) {
    const titleTag = gameTitle.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (titleTag) tags.push(titleTag);
  }

  return [...new Set(tags)];
}

let cachedSid: string | null = null;

function authHeaders(base: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    // qBittorrent's CSRF check compares these against the WebUI address.
    Referer: base,
    Origin: base,
    ...(cachedSid ? { Cookie: `SID=${cachedSid}` } : {}),
    ...extra,
  };
}

async function login(base: string): Promise<boolean> {
  const username = process.env.QBITTORRENT_USERNAME || process.env.QBIT_USERNAME || '';
  const password = process.env.QBITTORRENT_PASSWORD || process.env.QBIT_PASSWORD || '';

  // A WebUI with authentication bypassed for the local subnet needs no login;
  // treat missing credentials as "try anonymously" rather than as an error.
  if (!username && !password) {
    cachedSid = null;
    return true;
  }

  const response = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: base,
      Origin: base,
    },
    body: new URLSearchParams({ username, password }).toString(),
  });

  const body = (await response.text()).trim();
  if (!response.ok || body.toLowerCase().startsWith('fail')) {
    cachedSid = null;
    return false;
  }

  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/SID=([^;]+)/);
  cachedSid = match ? match[1] : null;
  return true;
}

async function postForm(base: string, path: string, form: URLSearchParams): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: authHeaders(base, { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: form.toString(),
  });
}

/**
 * Adds a magnet or .torrent URL to qBittorrent.
 *
 * Never throws: callers get a structured result so the UI can explain what
 * happened instead of surfacing a transport error.
 */
export async function addTorrentToQbit(params: QbitAddParams): Promise<QbitResult> {
  const base = getQbitBaseUrl();
  if (!base) {
    return {
      ok: false,
      outcome: 'disabled',
      message: 'qBittorrent is not configured on this server. Set QBITTORRENT_URL.',
    };
  }

  const url = (params.url || '').trim();
  if (!isTorrentUrl(url)) {
    return {
      ok: false,
      outcome: 'rejected',
      message: 'Only magnet links and .torrent URLs can be sent to qBittorrent.',
    };
  }

  const category = (params.category || getQbitCategory()).trim();
  const tags = params.tags?.length ? params.tags : getQbitTags(params.gameTitle);
  const savePath = (params.savePath || process.env.QBIT_SAVE_PATH || '').trim();

  const form = new URLSearchParams();
  form.set('urls', url);
  if (category) form.set('category', category);
  if (tags.length) form.set('tags', tags.join(','));
  if (savePath) form.set('savepath', savePath);
  const paused = params.paused ?? envFlag('QBIT_ADD_PAUSED', false);
  form.set('paused', paused ? 'true' : 'false');

  try {
    let response = await postForm(base, '/api/v2/torrents/add', form);

    // 403 means the cached SID expired (or we never had one). Re-auth once.
    if (response.status === 403) {
      if (!(await login(base))) {
        return {
          ok: false,
          outcome: 'auth',
          message: 'qBittorrent rejected the credentials. Check QBITTORRENT_USERNAME / QBITTORRENT_PASSWORD.',
        };
      }
      response = await postForm(base, '/api/v2/torrents/add', form);
    }

    const body = (await response.text()).trim();

    if (response.status === 403) {
      return {
        ok: false,
        outcome: 'auth',
        message: 'qBittorrent refused the request (403). Check the credentials, and that the WebUI allows requests from this host.',
      };
    }

    if (!response.ok || body.toLowerCase().startsWith('fail')) {
      return {
        ok: false,
        outcome: 'rejected',
        message: `qBittorrent did not accept the torrent${body ? ` (${body})` : ` (HTTP ${response.status})`}.`,
      };
    }

    logger.info(`Added torrent to qBittorrent [${category}] ${params.gameTitle || url.slice(0, 60)}`);
    return {
      ok: true,
      outcome: 'added',
      message: `Added to qBittorrent under "${category}".`,
      category,
      tags,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    logger.error(`Could not reach qBittorrent at ${base}: ${message}`);
    return {
      ok: false,
      outcome: 'unreachable',
      message: `Could not reach qBittorrent at ${base}. Check QBITTORRENT_URL and that both containers share a network.`,
    };
  }
}
