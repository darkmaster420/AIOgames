import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import {
  getEnvPosters,
  getStoredPosters,
  saveStoredPosters,
} from '../../../../lib/trustedPosters';

/**
 * cs.rin.ru poster reputation, editable at runtime from the admin settings tab.
 *
 * For each of `trusted` and `untrusted`: `stored` is the editable list and `env`
 * is the read-only baseline from the corresponding env var, always applied on
 * top and not removable here. PUT replaces one or both stored lists.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [trusted, untrusted] = await Promise.all([
    getStoredPosters('trusted'),
    getStoredPosters('untrusted'),
  ]);

  return NextResponse.json({
    trusted: { stored: trusted, env: getEnvPosters('trusted') },
    untrusted: { stored: untrusted, env: getEnvPosters('untrusted') },
  });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { trusted?: unknown; untrusted?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const clean = (value: unknown): string[] | null => {
    if (!Array.isArray(value) || !value.every(p => typeof p === 'string')) return null;
    // Cap length so a paste accident cannot store an unbounded blob.
    return value.map(p => p.trim()).filter(Boolean).slice(0, 200);
  };

  // Only the lists present in the body are updated, so the UI can save one
  // panel without clobbering the other.
  if (body.trusted !== undefined) {
    const trusted = clean(body.trusted);
    if (!trusted) {
      return NextResponse.json({ error: 'trusted must be an array of strings' }, { status: 400 });
    }
    await saveStoredPosters('trusted', trusted);
  }

  if (body.untrusted !== undefined) {
    const untrusted = clean(body.untrusted);
    if (!untrusted) {
      return NextResponse.json({ error: 'untrusted must be an array of strings' }, { status: 400 });
    }
    await saveStoredPosters('untrusted', untrusted);
  }

  const [trusted, untrusted] = await Promise.all([
    getStoredPosters('trusted'),
    getStoredPosters('untrusted'),
  ]);

  return NextResponse.json({
    trusted: { stored: trusted, env: getEnvPosters('trusted') },
    untrusted: { stored: untrusted, env: getEnvPosters('untrusted') },
  });
}
