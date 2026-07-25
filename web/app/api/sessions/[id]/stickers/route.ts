import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const stickers = await prisma.sticker.findMany({
    where: { sessionId: params.id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    stickers: stickers.map((s) => ({
      tag: s.tag,
      mimetype: s.mimetype,
      data: s.data.toString('base64'),
      createdAt: s.createdAt,
    })),
  });
}
