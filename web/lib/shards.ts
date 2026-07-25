import { prisma } from './prisma';

// Gateway instances a new WhatsApp session can be assigned to. Each entry
// is the base URL of a running gateway (see gateway/src/index.js) -- every
// gateway instance is independent and holds its own subset of sessions, so
// this is how load gets spread across more than one host (e.g. to stay
// within a single free-tier instance's RAM/CPU limits).
//
// Configure via GATEWAY_SHARD_URLS as a comma-separated list. Falls back to
// the single GATEWAY_URL for local dev / the common single-shard case. This
// is now only the fallback path -- see pickShardForNewSession below.
const DEFAULT_GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';

const ENV_SHARD_URLS = (process.env.GATEWAY_SHARD_URLS || DEFAULT_GATEWAY_URL)
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

// Picks which shard a brand-new session should live on. Prefers shards
// managed via the admin panel (/dashboard/admin/shards) so they can be
// added/removed without a redeploy; falls back to the env-var list above
// whenever there are zero active DB rows -- covers both "nobody's touched
// the admin panel yet" and "an admin disabled every shard" the same way.
// Random selection is enough to spread load roughly evenly without needing
// any shared counter state; every session already stores its own assigned
// gatewayUrl once picked, so this is the one place to upgrade later (e.g.
// to capacity-aware assignment) without touching anything else.
export async function pickShardForNewSession(): Promise<string> {
  const dbShards = await prisma.gatewayShard.findMany({ where: { active: true } });
  const urls = dbShards.length > 0 ? dbShards.map((s) => s.url) : ENV_SHARD_URLS;
  return urls[Math.floor(Math.random() * urls.length)];
}
