import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';
import { listSessionsWithStatus } from '@/lib/adminSessions';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const shard = await prisma.gatewayShard.findUnique({ where: { id: params.id } });
  if (!shard) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sessions = await listSessionsWithStatus({ gatewayUrl: shard.url });
  return NextResponse.json({ shard, sessions });
}
