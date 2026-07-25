import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const shard = await prisma.gatewayShard.findUnique({ where: { id: params.id } });
  if (!shard) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { url, label, active } = await req.json();
  const data: { url?: string; label?: string | null; active?: boolean } = {};

  if (url !== undefined) {
    if (typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: 'url must be a non-empty string' }, { status: 400 });
    }
    try {
      new URL(url.trim());
    } catch {
      return NextResponse.json({ error: 'url must be a valid URL' }, { status: 400 });
    }
    data.url = url.trim();
  }
  if (label !== undefined) {
    data.label = typeof label === 'string' && label.trim() ? label.trim() : null;
  }
  if (active !== undefined) {
    data.active = Boolean(active);
  }

  try {
    const updated = await prisma.gatewayShard.update({ where: { id: params.id }, data });
    return NextResponse.json({ shard: updated });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'That URL is already registered' }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.gatewayShard.deleteMany({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
