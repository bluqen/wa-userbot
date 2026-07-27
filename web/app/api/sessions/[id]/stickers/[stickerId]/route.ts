import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';

// Deletes one specific sticker by id -- not by tag, since multiple
// stickers can now share the same tag on purpose (see the Sticker model),
// so deleting "by tag" would have wiped out every variant saved under it.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; stickerId: string } },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Scoped to this session too, not just the sticker id, so one session
  // can't delete another session's sticker by guessing/reusing an id.
  await prisma.sticker.deleteMany({ where: { id: params.stickerId, sessionId: params.id } });

  return NextResponse.json({ ok: true });
}
