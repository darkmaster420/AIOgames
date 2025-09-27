// Scheduler Management API - Control automatic update scheduling
import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../lib/auth';
import { updateScheduler } from '../../../lib/scheduler';

// GET: Get scheduler status
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const status = updateScheduler.getStatus();
    
    return NextResponse.json({
      ...status,
      message: `Scheduler is ${status.isRunning ? 'running' : 'stopped'} with ${status.scheduledUsers} users scheduled`
    });

  } catch (error) {
    console.error('Scheduler status error:', error);
    return NextResponse.json(
      { error: 'Failed to get scheduler status' },
      { status: 500 }
    );
  }
}

// POST: Update user's schedule or perform admin actions
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'updateSchedule':
        // Update the current user's schedule
        await updateScheduler.updateUserSchedule(user.id);
        return NextResponse.json({
          message: 'User schedule updated successfully'
        });

      case 'getStatus':
        // Get detailed status for the current user
        const status = updateScheduler.getStatus();
        return NextResponse.json({
          ...status,
          message: `Your automatic updates are ${status.isRunning ? 'enabled' : 'disabled'}`
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Scheduler management error:', error);
    return NextResponse.json(
      { error: 'Failed to manage scheduler' },
      { status: 500 }
    );
  }
}