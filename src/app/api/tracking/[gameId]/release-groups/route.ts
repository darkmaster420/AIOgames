import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import connectDB from '../../../../../lib/db';
import { ReleaseGroupVariant } from '../../../../../lib/models';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { gameId } = await params;

    if (!gameId) {
      return NextResponse.json(
        { error: 'Game ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Get all release group variants for this game
    const variants = await ReleaseGroupVariant.find({
      gameId: gameId
    }).sort({ detectedAt: -1 }); // Most recent first

    // Group by release group and get the latest version for each
    const releaseGroups = variants.reduce((acc: any[], variant) => {
      const existing = acc.find((v: any) => v.releaseGroup === variant.releaseGroup);
      if (!existing) {
        acc.push({
          releaseGroup: variant.releaseGroup,
          title: variant.title,
          version: variant.version,
          buildNumber: variant.buildNumber,
          detectedAt: variant.detectedAt,
          _id: variant._id
        });
      }
      return acc;
    }, []);

    return NextResponse.json({
      gameId,
      releaseGroups,
      totalVariants: variants.length
    });

  } catch (error) {
    console.error('Get release groups error:', error);
    return NextResponse.json(
      { error: 'Failed to get release groups' },
      { status: 500 }
    );
  }
}