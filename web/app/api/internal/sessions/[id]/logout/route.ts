import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by a gateway instance when WhatsApp itself force-closes a
// connection with an actual "logged out" reason (the device was removed
// from the phone's Linked Devices list) -- not a transient network drop.
// Marking the session 'logged_out' here drops it out of
// /api/internal/gateway-sessions' reconnect-watchdog query for good,
// instead of the watchdog silently re-attempting it forever.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await prisma.waSession.updateMany({
    where: { id: params.id },
    data: { status: 'logged_out' },
  });

  return NextResponse.json({ ok: true });
}
