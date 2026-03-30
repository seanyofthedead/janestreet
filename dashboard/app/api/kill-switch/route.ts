import { NextRequest, NextResponse } from 'next/server';

const WATCHDOG_URL = 'http://localhost:3002/kill';

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');

  if (!apiKey || apiKey.trim().length === 0) {
    return NextResponse.json(
      { success: false, message: 'API key is required' },
      { status: 401 }
    );
  }

  try {
    const res = await fetch(WATCHDOG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: data.message || `Watchdog returned ${res.status}` },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, message: 'Kill switch activated' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to contact watchdog';
    return NextResponse.json(
      { success: false, message },
      { status: 502 }
    );
  }
}
