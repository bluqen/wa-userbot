import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { isPluginKey } from '@/lib/plugins';

export async function PATCH(req: Request, { params }: { params: { id: string; key: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isPluginKey(params.key)) {
    return NextResponse.json({ error: 'Unknown plugin' }, { status: 400 });
  }

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const data: { enabled?: boolean; settings?: string } = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (body.settings && typeof body.settings === 'object') {
    data.settings = JSON.stringify(body.settings);
  }

  const row = await prisma.sessionPlugin.upsert({
    where: { sessionId_key: { sessionId: session.id, key: params.key } },
    create: {
      sessionId: session.id,
      key: params.key,
      enabled: data.enabled ?? false,
      settings: data.settings ?? '{}',
    },
    update: data,
  });

  return NextResponse.json({ key: row.key, enabled: row.enabled, settings: JSON.parse(row.settings) });
}
