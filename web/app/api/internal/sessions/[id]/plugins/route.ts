import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PLUGIN_DEFAULTS, isPluginKey } from '@/lib/plugins';

const HISTORY_LIMIT_MAX = 50;

// Called by the Python plugin engine (server-to-server, no browser involved)
// to fetch a session's enabled plugin configs, and -- when a `contact`
// query param is given -- recent chat history for that contact too, so a
// reply plugin can build multi-turn context in one round trip instead of
// two. Not user-authenticated -- there's no logged-in user in this
// context -- so it's gated by a shared secret instead.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await prisma.sessionPlugin.findMany({
    where: { sessionId: params.id, enabled: true },
  });

  const plugins = rows.map((row) => ({
    key: row.key,
    enabled: row.enabled,
    settings: isPluginKey(row.key)
      ? { ...PLUGIN_DEFAULTS[row.key], ...JSON.parse(row.settings) }
      : JSON.parse(row.settings),
  }));

  const { searchParams } = new URL(req.url);
  const contact = searchParams.get('contact');

  if (!contact) {
    return NextResponse.json({ plugins });
  }

  const limitParam = Number(searchParams.get('limit'));
  const limit = Math.min(
    HISTORY_LIMIT_MAX,
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10,
  );

  const recent = await prisma.chatMessage.findMany({
    where: { sessionId: params.id, contactJid: contact },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const history = recent.reverse().map((m) => ({ role: m.role, text: m.text }));

  return NextResponse.json({ plugins, history });
}
