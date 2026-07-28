import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const notes = await prisma.note.findMany({
    where: { sessionId: params.id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      text: n.text,
      mediaType: n.mediaType,
      mimetype: n.mimetype,
      fileName: n.fileName,
      // Only images/stickers get an inline thumbnail preview -- video/
      // audio/document notes just show as an icon + filename, keeping the
      // list payload reasonable even with several media notes saved.
      data:
        n.data && (n.mediaType === 'imageMessage' || n.mediaType === 'stickerMessage')
          ? n.data.toString('base64')
          : null,
      createdAt: n.createdAt,
    })),
  });
}
