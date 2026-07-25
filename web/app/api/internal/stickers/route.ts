import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by the gateway when the account owner teaches the bot a sticker
// via "/savesticker <tag>" (see gateway/README.md). Upserts by
// (sessionId, tag) -- re-saving a tag overwrites it.
export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, tag, data, mimetype } = await req.json();
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof tag !== 'string' || !tag) {
    return NextResponse.json({ error: 'tag is required' }, { status: 400 });
  }
  if (typeof data !== 'string' || !data) {
    return NextResponse.json({ error: 'data (base64) is required' }, { status: 400 });
  }

  const buffer = Buffer.from(data, 'base64');
  const resolvedMimetype = typeof mimetype === 'string' && mimetype ? mimetype : 'image/webp';

  await prisma.sticker.upsert({
    where: { sessionId_tag: { sessionId, tag } },
    create: { sessionId, tag, data: buffer, mimetype: resolvedMimetype },
    update: { data: buffer, mimetype: resolvedMimetype },
  });

  return NextResponse.json({ ok: true });
}
