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

  // Exact-string matching here is fragile -- a trailing slash or casing
  // difference between this gateway's own PUBLIC_URL and whatever was typed
  // into the admin shards panel as this shard's url would silently match
  // zero sessions, permanently, on every restart (nothing ever logs it,
  // since an empty reconnect list looks identical to "nothing to do").
  // Normalize both sides before comparing instead of relying on Prisma
  // equality on the raw stored string.
  const normalize = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '');
  const target = normalize(gatewayUrl);

  const candidates = await prisma.waSession.findMany({
    where: { status: { notIn: ['disconnected', 'logged_out'] } },
    select: { id: true, phoneNumber: true, gatewayUrl: true },
  });

  const sessions = candidates.filter((s) => normalize(s.gatewayUrl) === target);

  return NextResponse.json({ sessions });
}
