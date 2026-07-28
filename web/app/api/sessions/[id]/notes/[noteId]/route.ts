import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; noteId: string } },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Scoped to this session too, not just the note id, so one session
  // can't delete another session's note by guessing/reusing an id.
  await prisma.note.deleteMany({ where: { id: params.noteId, sessionId: params.id } });

  return NextResponse.json({ ok: true });
}
