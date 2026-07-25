import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

export async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}
