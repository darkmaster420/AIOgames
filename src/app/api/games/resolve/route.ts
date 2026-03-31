import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { resolveBuildFromVersion, resolveVersionFromBuild } from '../../../../utils/steamApi';

// POST: Resolve version<->build via SteamDB Worker
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { appId, version, build } = await request.json();
    if (!appId || (!version && !build)) {
      return NextResponse.json({ error: 'appId and version or build are required' }, { status: 400 });
    }

    if (version) {
      const buildId = await resolveBuildFromVersion(appId, version);
      return NextResponse.json({ appId, version, build: buildId });
    }
    if (build) {
      const ver = await resolveVersionFromBuild(appId, build);
      return NextResponse.json({ appId, build, version: ver });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to resolve', message: (e as Error).message }, { status: 500 });
  }
}
