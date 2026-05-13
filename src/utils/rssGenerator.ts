import {
  mergeDownloadLinksForRss,
  type TrackedDownloadLink
} from '../lib/trackedGameDownloadLinks';
import { decodeHtmlEntities } from './steamApi';

export interface RSSItem {
  title: string;
  description: string;
  link: string;
  pubDate: Date;
  guid: string;
  image?: string;
  author?: string;
  category?: string[];
  enclosures?: Array<{
    url: string;
    type: string;
    length?: number;
  }>;
}

export interface RSSFeed {
  title: string;
  description: string;
  link: string;
  language?: string;
  managingEditor?: string;
  items: RSSItem[];
}

/**
 * Whether a download link can be used as an RSS enclosure for clients like qBittorrent
 * (magnet URI or HTTP(S) URL pointing at a .torrent resource).
 */
export function isTorrentEnclosureLink(link: { url: string; type?: string }): boolean {
  const t = (link.type || '').toLowerCase();
  if (t === 'magnet' || t === 'torrent-file' || t === 'torrent') return true;
  const url = link.url?.trim() || '';
  if (url.startsWith('magnet:')) return true;
  const lower = url.toLowerCase();
  if (lower.endsWith('.torrent') || lower.includes('.torrent?')) return true;
  if (lower.includes('/torrent/') || lower.includes('torrent.')) return true;
  if (lower.includes('xt=urn:btih:')) return true;
  return false;
}

function enclosureMimeType(link: { url: string; type?: string }): string {
  return isTorrentEnclosureLink(link) ? 'application/x-bittorrent' : 'application/octet-stream';
}

/** CDATA cannot contain the literal `]]>` — split so XML stays valid. */
function escapeCdataSection(content: string): string {
  return content.replace(/]]>/g, ']]]]><![CDATA[>');
}

/**
 * Generate RSS XML from feed data
 */
export function generateRSSXML(feed: RSSFeed): string {
  const items = feed.items
    .map(item => {
      const enclosures = item.enclosures
        ? item.enclosures
            .map(
              enc =>
                `    <enclosure url="${escapeXml(enc.url)}" type="${escapeXml(enc.type)}"${
                  enc.length ? ` length="${enc.length}"` : ''
                } />`
            )
            .join('\n')
        : '';

      const categories = item.category
        ? item.category.map(cat => `    <category>${escapeXml(cat)}</category>`).join('\n')
        : '';

      const image = item.image ? `    <image>\n      <url>${escapeXml(item.image)}</url>\n      <title>${escapeXml(item.title)}</title>\n      <link>${escapeXml(item.link)}</link>\n    </image>\n` : '';

      const descCdata = escapeCdataSection(item.description || '');

      return `  <item>
    <title>${escapeXml(item.title)}</title>
    <description><![CDATA[${descCdata}]]></description>
    <link>${escapeXml(item.link)}</link>
    <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
    <pubDate>${item.pubDate.toUTCString()}</pubDate>
${categories}
${enclosures}
${image}
  </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.link)}</link>
    <description>${escapeXml(feed.description)}</description>
${feed.language ? `    <language>${escapeXml(feed.language)}</language>` : ''}
${feed.managingEditor ? `    <managingEditor>${escapeXml(feed.managingEditor)}</managingEditor>` : ''}
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>AIOgames RSS Generator</generator>
${items}
  </channel>
</rss>`;
}

/**
 * Escape special XML characters
 */
export function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isMagnetLink(link: { url: string; type?: string }): boolean {
  const t = (link.type || '').toLowerCase();
  if (t === 'magnet') return true;
  return (link.url || '').trim().startsWith('magnet:');
}

function isHttpTorrentFileLink(link: { url: string; type?: string }): boolean {
  if ((link.type || '').toLowerCase() === 'torrent-file') return true;
  const u = (link.url || '').toLowerCase();
  return u.endsWith('.torrent') || u.includes('.torrent?');
}

/** One typical file-host / direct link (not magnet, not .torrent file). */
function isHosterLink(link: { url: string; type?: string }): boolean {
  if (!(link.url || '').trim()) return false;
  if (isMagnetLink(link)) return false;
  if (isHttpTorrentFileLink(link)) return false;
  return true;
}

function isGofileLink(link: { service: string; url: string; type?: string }): boolean {
  const s = (link.service || '').toLowerCase();
  const u = (link.url || '').toLowerCase();
  return s.includes('gofile') || u.includes('gofile');
}

function isBuzzheavierLink(link: { service: string; url: string; type?: string }): boolean {
  const s = (link.service || '').toLowerCase();
  const u = (link.url || '').toLowerCase();
  return s.includes('buzzheavier') || u.includes('buzzheavier');
}

/**
 * RSS description: at most one Gofile hoster, else one BuzzHeavier; never other hosters.
 * Always add a magnet when present, else a single HTTP .torrent link when no magnet.
 */
export function pickRssDownloadShowcaseLinks(
  links: Array<{ service: string; url: string; type?: string }>
): {
  preferredHoster?: { service: string; url: string; type?: string };
  magnetOrTorrent?: { service: string; url: string; type?: string };
} {
  const hosters = links.filter(isHosterLink);
  const gofile = hosters.find(isGofileLink);
  const buzz = hosters.find(isBuzzheavierLink);
  const preferredHoster = gofile ?? buzz;

  const magnet = links.find(isMagnetLink);
  if (magnet) {
    return { preferredHoster, magnetOrTorrent: magnet };
  }
  const torrentFile = links.find(l => isTorrentEnclosureLink(l) && !isMagnetLink(l));
  return { preferredHoster, magnetOrTorrent: torrentFile };
}

/** @deprecated Use pickRssDownloadShowcaseLinks — kept for any external imports. */
export function pickHosterAndMagnet(
  links: Array<{ service: string; url: string; type?: string }>
): {
  hoster?: { service: string; url: string; type?: string };
  magnet?: { service: string; url: string; type?: string };
} {
  const { preferredHoster, magnetOrTorrent } = pickRssDownloadShowcaseLinks(links);
  return { hoster: preferredHoster, magnet: magnetOrTorrent };
}

function hosterDisplayLabel(link: { service: string; url: string; type?: string }): string {
  if (isGofileLink(link)) return 'Gofile';
  if (isBuzzheavierLink(link)) return 'BuzzHeavier';
  const raw = (link.service || 'Host').trim();
  return raw || 'Host';
}

/** Short HTML: optional Gofile/BuzzHeavier + magnet or .torrent (RSS description). */
export function formatRssDownloadShowcase(
  hoster?: { service: string; url: string; type?: string },
  magnetOrTorrent?: { service: string; url: string; type?: string }
): string {
  if (!hoster && !magnetOrTorrent) return '';
  const parts: string[] = ['<br/><h3>Downloads</h3><p>'];
  if (hoster) {
    const label = escapeXml(hosterDisplayLabel(hoster));
    parts.push(`<a href="${escapeXml(hoster.url)}">${label}</a>`);
  }
  if (magnetOrTorrent) {
    if (hoster) parts.push(' · ');
    const tLabel = isMagnetLink(magnetOrTorrent) ? 'Magnet' : 'Torrent';
    parts.push(`<a href="${escapeXml(magnetOrTorrent.url)}">${tLabel}</a>`);
  }
  parts.push('</p>');
  return parts.join('');
}

/**
 * Convert tracked game data to RSS items
 */
export type GamesToRSSItemsOptions = {
  /** torrents: only magnet / .torrent enclosures (default; qBittorrent-friendly). all: every link as enclosure. */
  enclosures?: 'torrents' | 'all';
};

export function gamesToRSSItems(
  games: Array<{
    _id: string;
    title: string;
    originalTitle?: string;
    source: string;
    gameLink: string;
    image?: string;
    lastKnownVersion?: string;
    lastVersionDate?: string | Date;
    dateAdded: Date;
    description?: string;
    rssCachedDownloadLinks?: Array<{ service: string; url: string; type?: string }>;
    updateHistory?: Array<{
      version: string;
      dateFound: string | Date;
      downloadLinks?: Array<{ service: string; url: string; type?: string }>;
    }>;
    latestApprovedUpdate?: {
      version: string;
      dateFound: string | Date;
      downloadLinks?: Array<{ service: string; url: string; type?: string }>;
    };
    rssDownloadLinksFetchedAt?: string | Date;
  }>,
  options?: GamesToRSSItemsOptions
): RSSItem[] {
  const enclosureMode = options?.enclosures === 'all' ? 'all' : 'torrents';
  return games.map(game => {
    let pubDate = new Date();

    if (game.latestApprovedUpdate?.dateFound) {
      pubDate = new Date(game.latestApprovedUpdate.dateFound);
    } else if (game.lastVersionDate) {
      pubDate = new Date(game.lastVersionDate);
    } else {
      pubDate = game.dateAdded;
    }

    let description = game.description || '';

    if (game.lastKnownVersion) {
      if (description) description += '\n\n';
      description += `<strong>Latest Version:</strong> ${escapeXml(game.lastKnownVersion)}`;
    }

    if (description) description += '<br/>';
    description += `<strong>Source:</strong> ${escapeXml(game.source)}`;

    const downloadLinks: TrackedDownloadLink[] = mergeDownloadLinksForRss(game);

    const { preferredHoster, magnetOrTorrent } = pickRssDownloadShowcaseLinks(downloadLinks);
    description += formatRssDownloadShowcase(preferredHoster, magnetOrTorrent);

    const enclosureLinks =
      enclosureMode === 'all'
        ? downloadLinks.filter(link => link.url)
        : downloadLinks.filter(link => link.url && isTorrentEnclosureLink(link));

    const enclosures = enclosureLinks.map(link => ({
      url: link.url,
      type: enclosureMimeType(link),
      length: undefined
    }));

    return {
      title: game.title || game.originalTitle || 'Unknown Game',
      description,
      link: game.gameLink,
      guid: `${game._id}:${pubDate.getTime()}`,
      pubDate,
      image: game.image,
      author: game.source,
      category: [game.source],
      enclosures: enclosures.length > 0 ? enclosures : undefined
    };
  });
}
