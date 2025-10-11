import { NextResponse } from 'next/server';
import { getVersionInfo } from '../../../utils/version';

export async function GET() {
  try {
    const versionInfo = getVersionInfo();
    
    return NextResponse.json({
      success: true,
      data: versionInfo
    });
  } catch (error) {
    console.error('Error getting version info:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get version info' 
      },
      { status: 500 }
    );
  }
}