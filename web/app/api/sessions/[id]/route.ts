import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { gatewayLogout } from '@/lib/gateway';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await gatewayLogout(session.gatewayUrl, session.id).catch(() => {});
  await prisma.waSession.delete({ where: { id: session.id } });

  return NextResponse.json({ ok: true });
}
