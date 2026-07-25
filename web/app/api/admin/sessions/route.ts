import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { listSessionsWithStatus } from '@/lib/adminSessions';

// Cross-user view for admins -- unlike /api/sessions (scoped to the caller's
// own sessions), this returns every WaSession across every account, with
// the owner's email joined in, so an admin can see/manage sessions on a
// shard they're about to decommission or investigate without needing that
// user's login.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessions = await listSessionsWithStatus();
  return NextResponse.json({ sessions });
}
