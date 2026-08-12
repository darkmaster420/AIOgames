import { NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { getCurrentUser } from '../../../../lib/auth';
import { AutoDownloadJob } from '../../../../lib/models';
import { isJd2StatusConfigured } from '../../../../lib/jd2Client';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const jobs = await AutoDownloadJob.find({ userId: user.id })
    .select('trackedGameId packageName downloader status message currentHost attemptedHosts progressBytes totalBytes speedBytesPerSecond etaSeconds retryCount lastStatusAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(250)
    .lean();

  const seen = new Set<string>();
  const latest = jobs.filter(job => {
    const id = String(job.trackedGameId || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(job => ({
    id: String(job._id),
    trackedGameId: String(job.trackedGameId),
    packageName: job.packageName,
    downloader: job.downloader,
    status: job.status,
    message: job.message,
    currentHost: job.currentHost,
    attemptedHosts: job.attemptedHosts || [],
    progressBytes: job.progressBytes || 0,
    totalBytes: job.totalBytes || 0,
    speedBytesPerSecond: job.speedBytesPerSecond || 0,
    etaSeconds: job.etaSeconds || 0,
    retryCount: job.retryCount || 0,
    lastStatusAt: job.lastStatusAt || job.updatedAt,
  }));

  return NextResponse.json({ configured: isJd2StatusConfigured(), jobs: latest });
}
