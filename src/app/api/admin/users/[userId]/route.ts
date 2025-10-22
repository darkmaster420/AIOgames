import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { User } from '../../../../../lib/models';
import { getCurrentUser } from '../../../../../lib/auth';
import { isOwner, isAdminOrOwner } from '../../../../../lib/seedOwner';
import logger from '../../../../../utils/logger';

// PATCH: Update user role or ban status
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await params;
    const { action, role, reason } = await req.json();

    await connectDB();

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Handle role changes (owner only)
    if (action === 'setRole') {
      const isOwnerUser = await isOwner(currentUser.id);
      if (!isOwnerUser) {
        return NextResponse.json(
          { error: 'Forbidden - Owner access required to change roles' },
          { status: 403 }
        );
      }

      if (!['user', 'admin'].includes(role)) {
        return NextResponse.json(
          { error: 'Invalid role. Must be user or admin' },
          { status: 400 }
        );
      }

      // Cannot change owner role
      if (targetUser.role === 'owner') {
        return NextResponse.json(
          { error: 'Cannot change owner role' },
          { status: 403 }
        );
      }

      targetUser.role = role;
      await targetUser.save();

      logger.info(`Owner ${currentUser.email} changed ${targetUser.email} role to ${role}`);

      return NextResponse.json({
        message: `User role updated to ${role}`,
        user: {
          id: targetUser._id,
          email: targetUser.email,
          role: targetUser.role
        }
      });
    }

    // Handle ban/unban (admin or owner)
    if (action === 'ban' || action === 'unban') {
      const isAdmin = await isAdminOrOwner(currentUser.id);
      if (!isAdmin) {
        return NextResponse.json(
          { error: 'Forbidden - Admin access required' },
          { status: 403 }
        );
      }

      // Cannot ban owner or self
      if (targetUser.role === 'owner') {
        return NextResponse.json(
          { error: 'Cannot ban owner' },
          { status: 403 }
        );
      }

      if (targetUser._id.toString() === currentUser.id) {
        return NextResponse.json(
          { error: 'Cannot ban yourself' },
          { status: 403 }
        );
      }

      if (action === 'ban') {
        if (!reason) {
          return NextResponse.json(
            { error: 'Reason is required for banning' },
            { status: 400 }
          );
        }

        targetUser.banned = true;
        targetUser.bannedReason = reason;
        targetUser.bannedAt = new Date();
        targetUser.bannedBy = currentUser.id;

        logger.info(`Admin ${currentUser.email} banned user ${targetUser.email}: ${reason}`);
      } else {
        targetUser.banned = false;
        targetUser.bannedReason = '';
        targetUser.bannedAt = undefined;
        targetUser.bannedBy = undefined;

        logger.info(`Admin ${currentUser.email} unbanned user ${targetUser.email}`);
      }

      await targetUser.save();

      return NextResponse.json({
        message: action === 'ban' ? 'User banned successfully' : 'User unbanned successfully',
        user: {
          id: targetUser._id,
          email: targetUser.email,
          banned: targetUser.banned
        }
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    logger.error('Error managing user:', error);
    return NextResponse.json({ error: 'Failed to manage user' }, { status: 500 });
  }
}
