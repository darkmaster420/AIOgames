import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';

export async function GET() {
  try {
    const profile = await getCurrentUser();
    if (!profile) return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });

    await connectDB();
  const user = await User.findById(profile.id).select('email name role preferences username');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      username: user.username,
      preferences: user.preferences || {}
    });
  } catch (error) {
    console.error('GET /api/user/me error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
