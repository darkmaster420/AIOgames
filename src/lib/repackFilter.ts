/**
 * "Avoid repacks" filter shared by every endpoint that respects the user's
 * `releaseGroups.avoidRepacks` preference. Catches repacks two ways:
 *
 *   1. Title substring - some scene-site posts include "repack" / "-repack"
 *      in the title (the original heuristic).
 *   2. Source site - DODI and FitGirl are repack distributors by design;
 *      every post they publish is a repack regardless of how the title
 *      reads. Without this, e.g. a FitGirl post for "Cyberpunk 2077" still
 *      makes it through because the title doesn't contain "repack".
 */

const REPACK_SITE_TYPES = new Set<string>(['dodi', 'fitgirl']);

export function isRepackSiteType(siteType: string | null | undefined): boolean {
  return REPACK_SITE_TYPES.has((siteType || '').trim().toLowerCase());
}

function titleLooksLikeRepack(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return t.includes('repack') || t.includes('-repack');
}

/**
 * Returns true when this post should be dropped because the user has opted
 * to avoid repacks. Pass `avoidRepacks=false` and you'll always get false -
 * no need to guard the call site.
 */
export function isRepackPost(
  post: { title?: string | null; siteType?: string | null },
  avoidRepacks: boolean,
): boolean {
  if (!avoidRepacks) return false;
  return titleLooksLikeRepack(post.title) || isRepackSiteType(post.siteType);
}
