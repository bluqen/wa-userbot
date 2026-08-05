import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PLUGIN_DEFAULTS, isPluginKey } from '@/lib/plugins';
import { isAdminEmail } from '@/lib/admin';

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

  // A session id with no WaSession row is an *orphan*: a gateway process
  // still holding a live socket for a session that has since been deleted
  // (or re-paired under a new id). Without this check the query below just
  // returns zero rows, which is indistinguishable from "every plugin is
  // switched off" -- so the orphaned session keeps handling the account's
  // messages while silently ignoring every command, and toggling plugins
  // on the real session appears to do nothing. Say so explicitly instead.
  const session = await prisma.waSession.findUnique({
    where: { id: params.id },
    include: { user: { select: { email: true } } },
  });
  if (!session) {
    return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  }
  // Piggybacked here rather than a separate lookup -- this route is
  // already TTL-cached and polled by the gateway (see refreshPluginConfigs
  // in whatsappManager.js), so an admin-gated WhatsApp command (e.g.
  // "!status all") can check this without its own extra round trip.
  const isAdmin = isAdminEmail(session.user.email);

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

  // Piggybacked here rather than a separate endpoint -- this route is
  // already on /message's critical path (one round trip for config +
  // history together), and AI Reply needs to know which sticker tags
  // exist before it can offer one to the LLM. See ai_reply.py.
  const stickers = await prisma.sticker.findMany({
    where: { sessionId: params.id },
    select: { tag: true },
  });
  // Multiple stickers can share a tag on purpose (see the Sticker model) --
  // dedupe here so AI Reply's sticker instructions don't list the same tag
  // more than once.
  const stickerTags = [...new Set(stickers.map((s) => s.tag))];

  const { searchParams } = new URL(req.url);
  const contact = searchParams.get('contact');

  if (!contact) {
    return NextResponse.json({ plugins, stickerTags, isAdmin });
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

  return NextResponse.json({ plugins, history, stickerTags, isAdmin });
}
