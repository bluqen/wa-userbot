import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listSessionsWithStatus } from '@/lib/adminSessions';

// Server-to-server equivalent of /dashboard/admin/shards, for the "!status
// all" WhatsApp command (see whatsappManager.js) -- there's no NextAuth
// browser session in that context, so this is gated by the shared internal
// secret instead of requireAdmin(), same as every other /api/internal/*
// route. The caller (gateway) is responsible for checking the requesting
// session's own isAdmin flag before ever reaching for this.
export async function GET(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [shards, sessions] = await Promise.all([
    prisma.gatewayShard.findMany({ orderBy: { createdAt: 'asc' } }),
    listSessionsWithStatus(),
  ]);

  const summary = shards.map((shard) => {
    const shardSessions = sessions.filter((s) => s.gatewayUrl === shard.url);
    return {
      label: shard.label,
      url: shard.url,
      active: shard.active,
      pluginEngineUrl: shard.pluginEngineUrl,
      sessionCount: shardSessions.length,
      connectedCount: shardSessions.filter((s) => s.status === 'connected').length,
    };
  });

  return NextResponse.json({ shards: summary });
}
