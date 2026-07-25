import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// How much history we keep per (session, contact) pair, regardless of how
// large a plugin's configured historyLength is -- keeps storage bounded on
// a free-tier database.
const RETENTION_PER_CONTACT = 50;

// Called by the Python plugin engine to append one message (either side of
// the conversation) to a session's chat history. Same shared-secret gate
// as the plugins endpoint -- no logged-in user in this context.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { contact, role, text } = await req.json();
  if (typeof contact !== 'string' || !contact) {
    return NextResponse.json({ error: 'contact is required' }, { status: 400 });
  }
  if (role !== 'user' && role !== 'assistant') {
    return NextResponse.json({ error: "role must be 'user' or 'assistant'" }, { status: 400 });
  }
  if (typeof text !== 'string' || !text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  await prisma.chatMessage.create({
    data: { sessionId: params.id, contactJid: contact, role, text },
  });

  const excess = await prisma.chatMessage.findMany({
    where: { sessionId: params.id, contactJid: contact },
    orderBy: { createdAt: 'desc' },
    skip: RETENTION_PER_CONTACT,
    select: { id: true },
  });
  if (excess.length) {
    await prisma.chatMessage.deleteMany({ where: { id: { in: excess.map((m) => m.id) } } });
  }

  return NextResponse.json({ ok: true });
}
