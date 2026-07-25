import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { PLUGIN_KEYS, PLUGIN_DEFAULTS, PLUGIN_META } from '@/lib/plugins';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await prisma.waSession.findUnique({ where: { id: params.id } });
  if (!session || session.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const existing = await prisma.sessionPlugin.findMany({ where: { sessionId: session.id } });
  const byKey = new Map(existing.map((p) => [p.key, p]));

  const plugins = await Promise.all(
    PLUGIN_KEYS.map(async (key) => {
      let row = byKey.get(key);
      if (!row) {
        row = await prisma.sessionPlugin.create({
          data: {
            sessionId: session.id,
            key,
            enabled: false,
            settings: JSON.stringify(PLUGIN_DEFAULTS[key]),
          },
        });
      }
      return {
        key,
        name: PLUGIN_META[key].name,
        description: PLUGIN_META[key].description,
        enabled: row.enabled,
        settings: JSON.parse(row.settings),
      };
    }),
  );

  return NextResponse.json({ plugins });
}
