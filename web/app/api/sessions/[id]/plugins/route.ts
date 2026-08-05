import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { PLUGIN_KEYS, PLUGIN_DEFAULTS, PLUGIN_META, isDefaultEnabled } from '@/lib/plugins';

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
            enabled: isDefaultEnabled(key),
            settings: JSON.stringify(PLUGIN_DEFAULTS[key]),
          },
        });
      }
      return {
        key,
        name: PLUGIN_META[key].name,
        description: PLUGIN_META[key].description,
        icon: PLUGIN_META[key].icon,
        enabled: row.enabled,
        // Merge over defaults so a field added to PLUGIN_DEFAULTS after a
        // session's settings were first saved doesn't come back missing
        // entirely -- saved values still win, this only backfills gaps.
        settings: { ...PLUGIN_DEFAULTS[key], ...JSON.parse(row.settings) },
      };
    }),
  );

  return NextResponse.json({ plugins });
}
