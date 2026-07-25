import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import AdminSessionsManager from '@/components/admin/AdminSessionsManager';

export default async function AdminSessionsPage() {
  const admin = await requireAdmin();
  if (!admin) notFound();

  return (
    <div>
      <h1 className="text-xl font-semibold">All sessions</h1>
      <p className="mt-1 text-sm text-slate-400">
        Every WhatsApp session across every account.
      </p>
      <div className="mt-6">
        <AdminSessionsManager />
      </div>
    </div>
  );
}
