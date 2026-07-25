import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Generic, reusable persisted scheduler -- see ScheduledTask in
// schema.prisma and gateway/src/scheduler.js for the polling/dispatch
// side. Called by a gateway instance to create a task (e.g. a temporary
// contact-unblock) and to fetch its own due, not-yet-completed tasks.
export async function GET(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const gatewayUrl = searchParams.get('gatewayUrl');
  if (!gatewayUrl) {
    return NextResponse.json({ error: 'gatewayUrl is required' }, { status: 400 });
  }

  const tasks = await prisma.scheduledTask.findMany({
    where: { completedAt: null, runAt: { lte: new Date() }, session: { gatewayUrl } },
    select: { id: true, sessionId: true, type: true, payload: true, runAt: true },
  });

  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, type, payload, runAt } = await req.json();
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof type !== 'string' || !type) {
    return NextResponse.json({ error: 'type is required' }, { status: 400 });
  }
  const runAtDate = new Date(runAt);
  if (Number.isNaN(runAtDate.getTime())) {
    return NextResponse.json({ error: 'runAt must be a valid date' }, { status: 400 });
  }

  const task = await prisma.scheduledTask.create({
    data: { sessionId, type, payload: JSON.stringify(payload ?? {}), runAt: runAtDate },
  });

  return NextResponse.json({ id: task.id });
}
