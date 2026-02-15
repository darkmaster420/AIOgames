import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { User, TrackedGame } from '../../../../lib/models';
import { getCurrentUser } from '../../../../lib/auth';
import bcrypt from 'bcryptjs';

// GET: Get all users for admin management
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';

    await connectDB();

    // Build search query
    const searchQuery = search 
      ? {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
          ]
        }
      : {};

    // Get users with tracked games count
    const users = await User.aggregate([
      { $match: searchQuery },
      {
        $lookup: {
          from: 'trackedgames',
          localField: '_id',
          foreignField: 'userId',
          as: 'trackedGames'
        }
      },
      {
        $addFields: {
          trackedGamesCount: { $size: '$trackedGames' },
          lastActivity: {
            $max: '$trackedGames.lastChecked'
          }
        }
      },
      {
        $project: {
          password: 0,
          trackedGames: 0
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]);

    // Get total count for pagination
    const totalUsers = await User.countDocuments(searchQuery);

    return NextResponse.json({
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
        hasNext: page * limit < totalUsers,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

// POST: Create a new user (admin only)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { email, password, name, username, role } = await req.json();

    // Validation
    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Email, password, and name are required' },
        { status: 400 }
      );
    }

    // Username validation (optional but if provided must be valid)
    let normalizedUsername: string | undefined = undefined;
    if (username) {
      normalizedUsername = String(username).toLowerCase().trim();
      if (normalizedUsername.length < 3 || normalizedUsername.length > 24) {
        return NextResponse.json(
          { error: 'Username must be between 3 and 24 characters' },
          { status: 400 }
        );
      }
      if (!/^[a-z0-9_]+$/.test(normalizedUsername)) {
        return NextResponse.json(
          { error: 'Username can only contain lowercase letters, numbers, and underscores' },
          { status: 400 }
        );
      }
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      );
    }

    // Role validation (optional, defaults to 'user')
    const validRoles = ['user', 'admin'];
    const userRole = role && validRoles.includes(role) ? role : 'user';

    await connectDB();

    // Check if user/email/username already exists
    const existingUser = await User.findOne({ 
      $or: [
        { email: email.toLowerCase() },
        ...(normalizedUsername ? [{ username: normalizedUsername }] : [])
      ]
    });

    if (existingUser) {
      return NextResponse.json(
        { error: existingUser.email === email.toLowerCase() ? 'User with this email already exists' : 'Username already taken' },
        { status: 400 }
      );
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const newUser = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      name: name.trim(),
      role: userRole,
      ...(normalizedUsername ? { username: normalizedUsername } : {}),
    });

    await newUser.save();

    return NextResponse.json({
      message: 'User created successfully',
      user: {
        id: newUser._id,
        email: newUser.email,
        name: newUser.name,
        username: newUser.username,
        role: newUser.role,
      }
    }, { status: 201 });

  } catch (error) {
    console.error('User creation error:', error);
    
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}

// DELETE: Delete a user and their tracked games
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Delete user's tracked games first
    await TrackedGame.deleteMany({ userId });

    // Delete the user
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: `User ${deletedUser.name} and their tracked games have been deleted`,
      deletedUser: {
        id: deletedUser._id,
        name: deletedUser.name,
        email: deletedUser.email
      }
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}