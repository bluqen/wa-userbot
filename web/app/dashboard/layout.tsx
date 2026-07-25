import type { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import SignOutButton from '@/components/SignOutButton';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b border-surface-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <span className="text-lg font-semibold tracking-tight">WA Bot Console</span>
            <nav className="flex gap-1 text-sm">
              <Link
                href="/dashboard"
                className="rounded-md bg-surface-raised px-3 py-1.5 font-medium text-slate-100"
              >
                Sessions
              </Link>
              {isAdminEmail(session.user.email) && (
                <Link
                  href="/dashboard/admin"
                  className="rounded-md px-3 py-1.5 font-medium text-slate-300 hover:bg-surface-raised hover:text-slate-100"
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400">{session.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
