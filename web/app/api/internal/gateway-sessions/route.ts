import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by a gateway instance on startup to find out which sessions it
// used to be holding before the process restarted (a Render redeploy, a
// crash, anything) -- its own in-memory session map is empty at that
// point, and nothing else would tell it to reconnect them otherwise.
export async function GET(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const gatewayUrl = searchParams.get('gatewayUrl');
  if (!gatewayUrl) {
    return NextResponse.json({ error: 'gatewayUrl is required' }, { status: 400 });
  }

  const sessions = await prisma.waSession.findMany({
    where: { gatewayUrl, status: { notIn: ['disconnected', 'logged_out'] } },
    select: { id: true, phoneNumber: true },
  });

  return NextResponse.json({ sessions });
}
