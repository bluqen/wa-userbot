import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { gatewayStatus } from '@/lib/gateway';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const live = await gatewayStatus(session.gatewayUrl, session.id);
    if (live.status !== session.status) {
      await prisma.waSession.update({ where: { id: session.id }, data: { status: live.status } });
    }
    return NextResponse.json(live);
  } catch {
    return NextResponse.json({ status: session.status, pairingCode: null });
  }
}
