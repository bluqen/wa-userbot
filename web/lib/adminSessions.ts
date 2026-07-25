import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { gatewayStatus } from './gateway';

// Shared by /api/admin/sessions (all sessions) and
// /api/admin/shards/[id]/sessions (sessions scoped to one shard) -- both
// need the same live-status refresh plus the shard label joined in by
// matching gatewayUrl, so it isn't worth two copies of this loop.
export async function listSessionsWithStatus(where?: Prisma.WaSessionWhereInput) {
  const [sessions, shards] = await Promise.all([
    prisma.waSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } } },
    }),
    prisma.gatewayShard.findMany({ select: { url: true, label: true } }),
  ]);

  const shardLabelByUrl = new Map(shards.map((s) => [s.url, s.label]));

  return Promise.all(
    sessions.map(async (s) => {
      let status = s.status;
      if (status !== 'disconnected' && status !== 'logged_out') {
        try {
          const live = await gatewayStatus(s.gatewayUrl, s.id);
          if (live.status !== status) {
            await prisma.waSession.update({ where: { id: s.id }, data: { status: live.status } });
            status = live.status;
          }
        } catch {
          // gateway unreachable -- fall back to last known status
        }
      }
      return { ...s, status, shardLabel: shardLabelByUrl.get(s.gatewayUrl) ?? null };
    }),
  );
}
