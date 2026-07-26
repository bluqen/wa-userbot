import type { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import DashboardHeader from '@/components/DashboardHeader';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  return (
    <div className="min-h-screen">
      <DashboardHeader
        email={session.user.email ?? ''}
        isAdmin={isAdminEmail(session.user.email)}
      />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
