const ONLINE_FIX_SITE_TYPES = new Set(['onlinefix']);

export function isOnlineFixSiteType(siteType: string | null | undefined): boolean {
  return ONLINE_FIX_SITE_TYPES.has(String(siteType || '').trim().toLowerCase());
}

function textLooksLikeOnlineFix(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\b0xdeadcode\b/i.test(value)
    || /\b(?:online[-\s]?fix|onlinefix)\b/i.test(value)
    || /online-fix\.me/i.test(value);
}

/** Shared filter for releases that bundle or target online fixes. */
export function isOnlineFixPost(
  post: {
    title?: string | null;
    originalTitle?: string | null;
    source?: string | null;
    siteType?: string | null;
  },
  avoidOnlineFixes: boolean,
): boolean {
  if (!avoidOnlineFixes) return false;
  return isOnlineFixSiteType(post.siteType)
    || textLooksLikeOnlineFix(post.title)
    || textLooksLikeOnlineFix(post.originalTitle)
    || textLooksLikeOnlineFix(post.source);
}

