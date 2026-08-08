import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Cancels a pending "!sm" by its task id (see the /pending route, which is
// what "!sm list" reads before the owner picks a number to cancel).
//
// Scoped to sessionId + type='scheduled_send' rather than just the id --
// ScheduledTask ids are globally unique cuids so this is defense in depth,
// not a real ambiguity risk, but it does mean a stale or mistyped id
// reliably comes back "not found" instead of silently matching the wrong
// row. Marking completed rather than deleting: completedAt is exactly
// what the scheduler's due-task query already filters on, so a cancelled
// task simply never fires, with no new state to model.
export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, taskId } = await req.json();
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof taskId !== 'string' || !taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const result = await prisma.scheduledTask.updateMany({
    where: { id: taskId, sessionId, type: 'scheduled_send', completedAt: null },
    data: { completedAt: new Date() },
  });

  return NextResponse.json({ cancelled: result.count > 0 });
}
