import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { gatewayReconnect } from '@/lib/gateway';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await gatewayReconnect(session.gatewayUrl, session.id, session.phoneNumber);
    await prisma.waSession.update({ where: { id: session.id }, data: { status: result.status } });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: 'Could not reach the WhatsApp gateway' }, { status: 502 });
  }
}
