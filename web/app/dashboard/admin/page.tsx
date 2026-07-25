import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';

export default async function AdminIndexPage() {
  const admin = await requireAdmin();
  if (!admin) notFound();

  return (
    <div>
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-slate-400">Restricted to allowlisted admin accounts.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard/admin/sessions"
          className="rounded-xl border border-surface-border bg-surface-raised p-5 transition hover:bg-surface"
        >
          <h2 className="font-medium">Sessions</h2>
          <p className="mt-1 text-sm text-slate-400">
            View and manage every WhatsApp session across all accounts.
          </p>
        </Link>
        <Link
          href="/dashboard/admin/shards"
          className="rounded-xl border border-surface-border bg-surface-raised p-5 transition hover:bg-surface"
        >
          <h2 className="font-medium">Gateway shards</h2>
          <p className="mt-1 text-sm text-slate-400">
            Manage the pool of gateway instances new sessions get assigned to.
          </p>
        </Link>
      </div>
    </div>
  );
}
