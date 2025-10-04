import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';

export async function POST(request: NextRequest) {
  try {
  const { email, password, name, username } = await request.json();

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
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      name: name.trim(),
      ...(normalizedUsername ? { username: normalizedUsername } : {}),
    });

    await user.save();

    return NextResponse.json({
      message: 'User created successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        username: user.username,
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Registration error:', error);
    
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}