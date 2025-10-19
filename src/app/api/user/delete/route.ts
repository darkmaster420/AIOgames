import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth-options';
import connectDB from '../../../../lib/db';
import { User, TrackedGame } from '../../../../lib/models';

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    // Soft delete: deactivate user and their tracked games. If you want full deletion, change accordingly.
    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    user.isActive = false;
    await user.save();

    await TrackedGame.updateMany({ userId: user._id }, { isActive: false });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/user/delete error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
