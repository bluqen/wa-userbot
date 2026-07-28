import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by the gateway right before recalling a note via "#name" -- see
// whatsappManager.js's handleNoteRecall. Returns 404 if nothing was ever
// saved under that name (or it's been deleted since).
export async function GET(
  _req: Request,
  { params }: { params: { sessionId: string; name: string } },
) {
  const secret = _req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const note = await prisma.note.findUnique({
    where: { sessionId_name: { sessionId: params.sessionId, name: params.name } },
  });
  if (!note) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    kind: note.kind,
    text: note.text,
    data: note.data ? note.data.toString('base64') : null,
    mimetype: note.mimetype,
    mediaType: note.mediaType,
    fileName: note.fileName,
  });
}
