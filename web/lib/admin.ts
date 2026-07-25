import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function requireAdmin(): Promise<{ userId: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !isAdminEmail(email)) return null;
  return { userId, email };
}
