import { NextResponse } from 'next/server';

/**
 * Reports which configured sites are currently NOT usable because their
 * server-side prerequisites (env vars, etc) are missing. The frontend
 * uses this to hide chips for unusable sites so users don't pick a
 * source that would return nothing.
 *
 * Currently:
 *   - csrin: requires CSRIN_USERNAME + CSRIN_PASSWORD env vars. Without
 *     them the bot can't log in and every search returns empty.
 */
export async function GET() {
  const disabledSites: string[] = [];

  if (!process.env.CSRIN_USERNAME || !process.env.CSRIN_PASSWORD) {
    disabledSites.push('csrin');
  }

  return NextResponse.json({ disabledSites });
}
