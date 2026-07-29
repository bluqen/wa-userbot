import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by the "leads" plugin whenever it extracts a new lead signal --
// upserts by (sessionId, contactJid), latest summary wins.
export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, contactJid, summary } = await req.json();
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof contactJid !== 'string' || !contactJid) {
    return NextResponse.json({ error: 'contactJid is required' }, { status: 400 });
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    return NextResponse.json({ error: 'summary is required' }, { status: 400 });
  }

  await prisma.lead.upsert({
    where: { sessionId_contactJid: { sessionId, contactJid } },
    create: { sessionId, contactJid, summary: summary.trim() },
    update: { summary: summary.trim() },
  });

  return NextResponse.json({ ok: true });
}
