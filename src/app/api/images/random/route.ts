import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') || 'product';
    
    // Generate a seed from the query for consistent images
    const seed = query.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + Date.now();
    
    return NextResponse.json({
      url: `https://picsum.photos/seed/${seed}/400/400`,
    });
  } catch (error) {
    console.error('Error generating random image URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate random image' },
      { status: 500 }
    );
  }
}
