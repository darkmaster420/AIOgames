import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import logger from '../../../../utils/logger';
import crypto from 'crypto';

/**
 * GET /api/rss/token
 * Get the user's current RSS feed token, or null if not generated
 */
export async function GET(_req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    const userDoc = await User.findById(user.id).select('rssFeedToken rssFeedTokenCreatedAt');

    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      token: userDoc.rssFeedToken || null,
      createdAt: userDoc.rssFeedTokenCreatedAt || null,
      feedUrl: userDoc.rssFeedToken
        ? `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/rss/feed?token=${userDoc.rssFeedToken}`
        : null
    });
  } catch (error) {
    logger.error('RSS token fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch RSS token' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rss/token
 * Generate a new RSS feed token for the user (invalidates old token)
 */
export async function POST(_req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    // Generate a random token
    const token = crypto.randomBytes(32).toString('hex');

    const userDoc = await User.findByIdAndUpdate(
      user.id,
      {
        rssFeedToken: token,
        rssFeedTokenCreatedAt: new Date()
      },
      { new: true }
    ).select('rssFeedToken rssFeedTokenCreatedAt email');

    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    logger.info(`RSS token generated for user ${user.id}`);

    return NextResponse.json({
      success: true,
      token: userDoc.rssFeedToken,
      createdAt: userDoc.rssFeedTokenCreatedAt,
      feedUrl: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/rss/feed?token=${token}`,
      message: 'RSS feed token generated. Keep it private!'
    });
  } catch (error) {
    logger.error('RSS token generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate RSS token' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rss/token
 * Revoke the user's RSS feed token
 */
export async function DELETE(_req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectDB();

    await User.findByIdAndUpdate(
      user.id,
      {
        rssFeedToken: null,
        rssFeedTokenCreatedAt: null
      }
    );

    logger.info(`RSS token revoked for user ${user.id}`);

    return NextResponse.json({
      success: true,
      message: 'RSS feed token revoked'
    });
  } catch (error) {
    logger.error('RSS token revocation error:', error);
    return NextResponse.json(
      { error: 'Failed to revoke RSS token' },
      { status: 500 }
    );
  }
}
