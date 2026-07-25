import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Aiven's free tier caps total Postgres connections at 20, with several
// already reserved for Aiven's own background workers (TimescaleDB,
// pg_cron, failover slots, ...) -- leaving little headroom once this
// service, the gateway (its own separate pg.Pool), and Render briefly
// running the old + new instance of a service during a rolling deploy all
// hold connections at once. Cap this client's own pool explicitly rather
// than relying on Prisma's default (num_cpus * 2 + 1), which can ask for
// more than the database can actually spare.
function databaseUrlWithConnectionLimit(): string {
  const url = process.env.DATABASE_URL || '';
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=3`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasources: { db: { url: databaseUrlWithConnectionLimit() } } });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
