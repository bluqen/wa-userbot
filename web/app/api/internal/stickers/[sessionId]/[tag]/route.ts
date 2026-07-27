import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by the gateway right before sending a sticker AI Reply picked --
// see plugins/app/plugins/ai_reply.py's sticker marker handling. Multiple
// stickers can share a tag on purpose (see the Sticker model) -- picks a
// random one among them so re-using a tag adds variety to what actually
// gets sent instead of always being the same file.
export async function GET(
  _req: Request,
  { params }: { params: { sessionId: string; tag: string } },
) {
  const secret = _req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stickers = await prisma.sticker.findMany({
    where: { sessionId: params.sessionId, tag: params.tag },
  });
  if (stickers.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const sticker = stickers[Math.floor(Math.random() * stickers.length)];

  return NextResponse.json({ data: sticker.data.toString('base64'), mimetype: sticker.mimetype });
}
