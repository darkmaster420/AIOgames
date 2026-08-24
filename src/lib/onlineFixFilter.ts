const ONLINE_FIX_SITE_TYPES = new Set(['onlinefix']);

export function isOnlineFixSiteType(siteType: string | null | undefined): boolean {
  return ONLINE_FIX_SITE_TYPES.has(String(siteType || '').trim().toLowerCase());
}

function textLooksLikeOnlineFix(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\b0xdeadcode\b/i.test(value)
    || /\b(?:online[-\s]?fix|onlinefix)\b/i.test(value)
    || /online-fix\.me/i.test(value)
    // Release titles commonly advertise the bundled fix without naming its
    // provider, e.g. "+ Co-op", "CO_OP", or "Multi.Player".
    || /\b(?:co[\s._-]?op|co[\s._-]?operative|multi[\s._-]?player)\b/i.test(value);
}

/** Shared filter for releases that bundle or target online fixes. */
export function isOnlineFixPost(
  post: {
    title?: string | null;
    originalTitle?: string | null;
    source?: string | null;
    siteType?: string | null;
    // csrin flags Online-Fix explicitly (the marker lives in the post body /
    // download filename, never the clean title, so the text checks below miss
    // it) — honour that flag directly.
    csrinOnlineFix?: boolean | null;
  },
  avoidOnlineFixes: boolean,
): boolean {
  if (!avoidOnlineFixes) return false;
  return Boolean(post.csrinOnlineFix)
    || isOnlineFixSiteType(post.siteType)
    || textLooksLikeOnlineFix(post.title)
    || textLooksLikeOnlineFix(post.originalTitle)
    || textLooksLikeOnlineFix(post.source);
}
