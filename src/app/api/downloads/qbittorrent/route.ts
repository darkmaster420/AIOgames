import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import {
  addTorrentToQbit,
  getQbitBaseUrl,
  isTorrentUrl,
} from '../../../../lib/qbittorrent';
import logger from '../../../../utils/logger';

type QbitSendBody = {
  /** magnet: URI or http(s) .torrent URL. */
  url?: string;
  /** Used for the auto-tag, so the torrent is identifiable in qBittorrent. */
  title?: string;
  /** Optional per-send overrides; both default to the configured values. */
  category?: string;
  tags?: string[];
};

/** GET: whether the UI should offer a "send to qBittorrent" action at all. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ configured: Boolean(getQbitBaseUrl()) });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: QbitSendBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const url = (body.url || '').trim();
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    if (!isTorrentUrl(url)) {
      return NextResponse.json(
        { error: 'Only magnet links and .torrent URLs can be sent to qBittorrent.' },
        { status: 422 },
      );
    }

    if (!getQbitBaseUrl()) {
      return NextResponse.json(
        {
          error: 'qBittorrent is not configured on this server.',
          hint: 'Set QBITTORRENT_URL (plus QBITTORRENT_USERNAME / QBITTORRENT_PASSWORD if the WebUI requires a login).',
        },
        { status: 503 },
      );
    }

    const result = await addTorrentToQbit({
      url,
      gameTitle: (body.title || '').trim() || undefined,
      category: (body.category || '').trim() || undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : undefined,
    });

    if (!result.ok) {
      // Distinguish "you configured it wrong" from "the far end said no", so
      // the client can tell the user which one to go and fix.
      const status =
        result.outcome === 'disabled' ? 503
        : result.outcome === 'auth' ? 502
        : result.outcome === 'unreachable' ? 502
        : 422;
      return NextResponse.json({ error: result.message, outcome: result.outcome }, { status });
    }

    return NextResponse.json({
      message: result.message,
      outcome: result.outcome,
      category: result.category,
      tags: result.tags,
    });
  } catch (error) {
    logger.error('qBittorrent dispatch failed:', error);
    return NextResponse.json({ error: 'Failed to send to qBittorrent' }, { status: 500 });
  }
}
