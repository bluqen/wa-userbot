import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by the gateway when the account owner saves a note via
// "!savenote <name>" (see gateway/README.md). Upserts by (sessionId, name)
// -- unlike stickers, a note is meant to be one canonical named snippet,
// so re-saving a name overwrites it rather than adding a variant.
export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, name, kind, text, data, mimetype, mediaType, fileName } = await req.json();
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (kind !== 'text' && kind !== 'media') {
    return NextResponse.json({ error: 'kind must be "text" or "media"' }, { status: 400 });
  }
  if (kind === 'media' && (typeof data !== 'string' || !data)) {
    return NextResponse.json({ error: 'data (base64) is required for a media note' }, { status: 400 });
  }

  const buffer = kind === 'media' ? Buffer.from(data, 'base64') : null;

  await prisma.note.upsert({
    where: { sessionId_name: { sessionId, name } },
    create: {
      sessionId,
      name,
      kind,
      text: typeof text === 'string' ? text : '',
      data: buffer,
      mimetype: kind === 'media' ? mimetype || null : null,
      mediaType: kind === 'media' ? mediaType || null : null,
      fileName: kind === 'media' ? fileName || null : null,
    },
    update: {
      kind,
      text: typeof text === 'string' ? text : '',
      data: buffer,
      mimetype: kind === 'media' ? mimetype || null : null,
      mediaType: kind === 'media' ? mediaType || null : null,
      fileName: kind === 'media' ? fileName || null : null,
    },
  });

  return NextResponse.json({ ok: true });
}
