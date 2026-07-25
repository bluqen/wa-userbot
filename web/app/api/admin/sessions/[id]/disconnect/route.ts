import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';
import { gatewayLogout } from '@/lib/gateway';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await gatewayLogout(session.gatewayUrl, session.id).catch(() => {});
  await prisma.waSession.update({ where: { id: session.id }, data: { status: 'disconnected' } });

  return NextResponse.json({ ok: true });
}
