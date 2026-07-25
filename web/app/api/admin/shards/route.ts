import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const shards = await prisma.gatewayShard.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ shards });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { url, label } = await req.json();
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  try {
    new URL(url.trim());
  } catch {
    return NextResponse.json({ error: 'url must be a valid URL' }, { status: 400 });
  }

  try {
    const shard = await prisma.gatewayShard.create({
      data: {
        url: url.trim(),
        label: typeof label === 'string' && label.trim() ? label.trim() : null,
      },
    });
    return NextResponse.json({ shard });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'That URL is already registered' }, { status: 409 });
    }
    throw err;
  }
}
