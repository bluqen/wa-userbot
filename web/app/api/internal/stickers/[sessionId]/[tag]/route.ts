import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Called by the gateway right before sending a sticker AI Reply picked --
// see plugins/app/plugins/ai_reply.py's sticker marker handling.
export async function GET(
  _req: Request,
  { params }: { params: { sessionId: string; tag: string } },
) {
  const secret = _req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sticker = await prisma.sticker.findUnique({
    where: { sessionId_tag: { sessionId: params.sessionId, tag: params.tag } },
  });
  if (!sticker) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ data: sticker.data.toString('base64'), mimetype: sticker.mimetype });
}
