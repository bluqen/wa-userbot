import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Cancels a pending "!timer" that's long enough to live as a ScheduledTask
// rather than an in-memory countdown (see gateway/src/whatsappManager.js's
// scheduleLongTimer). The gateway only knows the timer by the id of the
// confirmation message the user replied "!stop" to, so the lookup is by
// the messageId recorded in the task's payload.
//
// Marking it completed rather than deleting it is deliberate: completedAt
// is exactly what the scheduler's due-task query already filters on, so a
// cancelled timer simply never fires, with no new state to model.
export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, messageId } = await req.json();
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof messageId !== 'string' || !messageId) {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
  }

  // Payload is an untyped JSON string (see the ScheduledTask model), so it
  // can't be queried into directly. Scoping to this session's own pending
  // timers keeps that set tiny, so parsing them here is cheap -- and it's
  // exact, unlike a substring match against the raw JSON.
  const pending = await prisma.scheduledTask.findMany({
    where: { sessionId, type: 'timer_done', completedAt: null },
    select: { id: true, payload: true },
  });

  const match = pending.find((task) => {
    try {
      return JSON.parse(task.payload || '{}').messageId === messageId;
    } catch {
      return false;
    }
  });

  if (!match) return NextResponse.json({ cancelled: false });

  await prisma.scheduledTask.update({
    where: { id: match.id },
    data: { completedAt: new Date() },
  });

  return NextResponse.json({ cancelled: true });
}
