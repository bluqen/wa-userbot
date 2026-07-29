import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';

const BROADCAST_TYPE = 'broadcast_message';

type BroadcastPayload = { jid: string; message: string; batchId: string };

// Broadcasts reuse the existing generic ScheduledTask table (see
// schema.prisma) rather than a dedicated model -- one row per recipient,
// all sharing a batchId in their JSON payload so the dashboard can still
// group/cancel them as a single logical broadcast without a schema change.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const tasks = await prisma.scheduledTask.findMany({
    where: { sessionId: params.id, type: BROADCAST_TYPE },
    orderBy: { runAt: 'desc' },
  });

  const batches = new Map<
    string,
    { batchId: string; message: string; runAt: Date; total: number; sent: number }
  >();
  for (const task of tasks) {
    let payload: BroadcastPayload;
    try {
      payload = JSON.parse(task.payload);
    } catch {
      continue;
    }
    const existing = batches.get(payload.batchId);
    if (existing) {
      existing.total += 1;
      if (task.completedAt) existing.sent += 1;
    } else {
      batches.set(payload.batchId, {
        batchId: payload.batchId,
        message: payload.message,
        runAt: task.runAt,
        total: 1,
        sent: task.completedAt ? 1 : 0,
      });
    }
  }

  return NextResponse.json({ broadcasts: Array.from(batches.values()) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { message, recipients, sendAt } = await req.json();
  if (typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'at least one recipient is required' }, { status: 400 });
  }

  const runAt = sendAt ? new Date(sendAt) : new Date();
  if (Number.isNaN(runAt.getTime())) {
    return NextResponse.json({ error: 'sendAt must be a valid date' }, { status: 400 });
  }

  const batchId = randomUUID();
  const digitsOnly = recipients
    .map((r) => String(r).replace(/\D/g, ''))
    .filter((r) => r.length > 0);
  if (digitsOnly.length === 0) {
    return NextResponse.json({ error: 'no valid recipient numbers found' }, { status: 400 });
  }

  await prisma.scheduledTask.createMany({
    data: digitsOnly.map((digits) => ({
      sessionId: params.id,
      type: BROADCAST_TYPE,
      payload: JSON.stringify({
        jid: `${digits}@s.whatsapp.net`,
        message: message.trim(),
        batchId,
      } satisfies BroadcastPayload),
      runAt,
    })),
  });

  return NextResponse.json({ batchId, recipientCount: digitsOnly.length });
}
