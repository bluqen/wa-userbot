import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by the gateway when the owner sends "/addbroadcast <name>" inside
// a group -- upserts by (sessionId, name) so re-using a name re-tags
// whichever group it was sent in most recently.
export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, name, jid, groupName } = await req.json();
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (typeof jid !== 'string' || !jid) {
    return NextResponse.json({ error: 'jid is required' }, { status: 400 });
  }

  await prisma.broadcastGroup.upsert({
    where: { sessionId_name: { sessionId, name } },
    create: { sessionId, name, jid, groupName: groupName || '' },
    update: { jid, groupName: groupName || '' },
  });

  return NextResponse.json({ ok: true });
}
