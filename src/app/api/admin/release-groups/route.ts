import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
// import connectDB from '../../../../lib/db';
// import { ReleaseGroupVariant } from '../../../../lib/models';

// In-memory trusted groups list (persist to DB later if needed)
const trustedGroups = new Set<string>([
  'RUNE','TENOKE','GOG','CODEX','SKIDROW','DODI','FITGIRL','EMPRESS','PLAZA','RAZOR1911','DARKSIDERS','HOODLUM','GOLDBERG','FLT','ELAMIGOS','TINYISO','0XDEADCODE','0XDEADCODE','ONLINE-FIX'
]);

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ trusted: Array.from(trustedGroups) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { group }: { group: string } = await req.json();
  if (!group || typeof group !== 'string') {
    return NextResponse.json({ error: 'Group name required' }, { status: 400 });
  }
  trustedGroups.add(group.toUpperCase());
  return NextResponse.json({ success: true, trusted: Array.from(trustedGroups) });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const group = searchParams.get('group');
  if (!group) return NextResponse.json({ error: 'Group param required' }, { status: 400 });
  trustedGroups.delete(group.toUpperCase());
  return NextResponse.json({ success: true, trusted: Array.from(trustedGroups) });
}
