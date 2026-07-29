import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';

const BROADCAST_TYPE = 'broadcast_message';

// Cancels every not-yet-sent recipient in a broadcast batch. Already-sent
// recipients (completedAt set) are left alone -- there's nothing to
// "cancel" about a message that already went out, and deleting that row
// would just erase the delivered/sent count on the dashboard.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; batchId: string } },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const candidates = await prisma.scheduledTask.findMany({
    where: { sessionId: params.id, type: BROADCAST_TYPE, completedAt: null },
    select: { id: true, payload: true },
  });

  const idsToDelete = candidates
    .filter((task) => {
      try {
        return JSON.parse(task.payload).batchId === params.batchId;
      } catch {
        return false;
      }
    })
    .map((task) => task.id);

  if (idsToDelete.length > 0) {
    await prisma.scheduledTask.deleteMany({ where: { id: { in: idsToDelete } } });
  }

  return NextResponse.json({ ok: true, cancelled: idsToDelete.length });
}
