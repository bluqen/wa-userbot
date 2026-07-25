import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';
import { ENV_SHARD_URLS } from '@/lib/shards';
import { nextFruitName } from '@/lib/fruitNames';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const shards = await prisma.gatewayShard.findMany({ orderBy: { createdAt: 'asc' } });

  // pickShardForNewSession() only falls back to the env-var list when there
  // are zero *active* DB rows -- surface both facts so the panel isn't
  // silently missing the shard that's actually in effect right now.
  const dbHasActiveShard = shards.some((s) => s.active);
  const registeredUrls = new Set(shards.map((s) => s.url));
  const envShards = ENV_SHARD_URLS.filter((url) => !registeredUrls.has(url)).map((url) => ({
    url,
    inEffect: !dbHasActiveShard,
  }));

  return NextResponse.json({ shards, envShards });
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

  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  const existing = await prisma.gatewayShard.findMany({ select: { label: true } });
  const finalLabel =
    trimmedLabel || nextFruitName(existing.map((s) => s.label).filter((l): l is string => !!l));

  try {
    const shard = await prisma.gatewayShard.create({
      data: { url: url.trim(), label: finalLabel },
    });
    return NextResponse.json({ shard });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'That URL is already registered' }, { status: 409 });
    }
    throw err;
  }
}
