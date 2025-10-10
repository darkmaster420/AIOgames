import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../../lib/db';
import { TrackedGame } from '../../../../../../lib/models';
import { getCurrentUser } from '../../../../../../lib/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify user is admin (you may want to add an isAdmin field to users)
    // For now, checking if user exists in the system
    await connectDB();
    const { User } = await import('../../../../../../lib/models');
    const dbUser = await User.findById(user.id);
    if (!dbUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { title, originalTitle } = await request.json();
    
    if ((!title && !originalTitle) || 
        (title && typeof title !== 'string') || 
        (originalTitle && typeof originalTitle !== 'string')) {
      return NextResponse.json(
        { error: 'Valid title or originalTitle is required' },
        { status: 400 }
      );
    }

    const { gameId } = await params;
    
    // Prepare update object
    const updateData: {
      lastModified: Date;
      title?: string;
      originalTitle?: string;
    } = {
      lastModified: new Date()
    };
    
    if (title !== undefined) {
      updateData.title = title.trim();
    }
    
    if (originalTitle !== undefined) {
      updateData.originalTitle = originalTitle.trim();
    }
    
    // Update the game title(s)
    const updatedGame = await TrackedGame.findByIdAndUpdate(
      gameId,
      updateData,
      { new: true }
    );

    if (!updatedGame) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Game title(s) updated successfully',
      game: {
        _id: updatedGame._id,
        title: updatedGame.title,
        originalTitle: updatedGame.originalTitle
      }
    });

  } catch (error) {
    console.error('Update game title error:', error);
    return NextResponse.json(
      { error: 'Failed to update game title' },
      { status: 500 }
    );
  }
}