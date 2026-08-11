import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import { getPostDetails } from '../../../../lib/gameapi';
import {
  dispatchManualDownloadToJd2,
  getJd2WatchDir,
} from '../../../../lib/jd2AutoDownloads';
import { normalizeDownloadLinks, type DownloadLinkLike } from '../../../../lib/downloadLinks';
import {
  buildFollowPostDownloadResponse,
  isFollowPostSiteType,
} from '../../../../lib/downloadSitePolicy';
import logger from '../../../../utils/logger';

/** Scraping the source post for links can be slow when FlareSolverr is cold. */
export const maxDuration = 60;

type Jd2SendBody = {
  /** Numeric WordPress post id from the gameapi (`originalId`). */
  postId?: string;
  siteType?: string;
  title?: string;
  /** Original post URL — recorded on the crawljob so JD2 shows where it came from. */
  gameLink?: string;
  version?: string;
  /** Links the caller already has, saving a round-trip to the source site. */
  downloadLinks?: DownloadLinkLike[];
};

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: Jd2SendBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const postId = (body.postId || '').trim();
    const siteType = (body.siteType || '').trim().toLowerCase();
    const title = (body.title || '').trim();
    const gameLink = (body.gameLink || '').trim();

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    // Fail fast with an actionable message rather than writing nothing and
    // reporting a vague failure.
    if (!getJd2WatchDir()) {
      return NextResponse.json(
        {
          error: 'JD2 Folder Watch is not configured on this server.',
          hint: 'Set JD2_FOLDERWATCH_DIR to the JDownloader folderwatch directory.',
        },
        { status: 503 },
      );
    }

    // Sites where links deliberately aren't machine-extractable — there is
    // nothing to hand JD2, so say so instead of dispatching an empty package.
    if (siteType && isFollowPostSiteType(siteType)) {
      const followPost = buildFollowPostDownloadResponse({ title, gameLink }, siteType);
      return NextResponse.json(
        {
          error: followPost.notice,
          noticeType: followPost.noticeType,
          noticeButtonLabel: followPost.noticeButtonLabel,
          postUrl: followPost.context.postUrl,
        },
        { status: 422 },
      );
    }

    let links = normalizeDownloadLinks(body.downloadLinks);

    if (links.length === 0) {
      if (!postId || !siteType) {
        return NextResponse.json(
          { error: 'Provide downloadLinks, or postId and siteType so links can be fetched.' },
          { status: 400 },
        );
      }

      const details = await getPostDetails(postId, siteType);
      if (!details.success) {
        return NextResponse.json(
          { error: details.error || 'Could not fetch download links from the source site.' },
          { status: 502 },
        );
      }
      links = normalizeDownloadLinks(details.post?.downloadLinks);
    }

    if (links.length === 0) {
      return NextResponse.json(
        { error: 'No download links could be found for this release.' },
        { status: 404 },
      );
    }

    await connectDB();

    // Attach the tracked game when the user already tracks this post, so the
    // send shows up in the same AutoDownloadJob ledger as automatic dispatches.
    let trackedGameId: string | undefined;
    if (postId && siteType) {
      const tracked = await TrackedGame.findOne({
        userId: user.id,
        gameId: `${siteType}_${postId}`,
      })
        .select('_id')
        .lean<{ _id: unknown } | null>();
      if (tracked?._id) trackedGameId = String(tracked._id);
    }

    const result = await dispatchManualDownloadToJd2({
      userId: user.id,
      trackedGameId,
      gameTitle: title,
      version: (body.version || '').trim() || undefined,
      gameLink: gameLink || postId,
      downloadLinks: links,
    });

    if (!result.ok) {
      // 'skipped' means we found links but none on a preferred host — a
      // configuration mismatch the user can act on, not a server fault.
      const status = result.outcome === 'skipped' ? 422 : 500;
      return NextResponse.json(
        {
          error: result.message,
          outcome: result.outcome,
          hierarchy: result.hierarchy,
          availableHosts: [...new Set(links.map(l => l.service))],
        },
        { status },
      );
    }

    return NextResponse.json({
      message: result.message,
      outcome: result.outcome,
      packageName: result.packageName,
      linkCount: result.linkCount,
      selectedHosts: result.selectedHosts,
      tracked: Boolean(trackedGameId),
    });
  } catch (error) {
    logger.error('Manual JD2 dispatch failed:', error);
    return NextResponse.json({ error: 'Failed to send to JDownloader' }, { status: 500 });
  }
}
