import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import ShardsManager from '@/components/admin/ShardsManager';

export default async function AdminShardsPage() {
  const admin = await requireAdmin();
  if (!admin) notFound();

  return (
    <div>
      <h1 className="text-xl font-semibold">Gateway shards</h1>
      <p className="mt-1 text-sm text-slate-400">
        Gateway instances new WhatsApp sessions get assigned to. Changes here take effect
        immediately -- no redeploy needed.
      </p>
      <div className="mt-6">
        <ShardsManager />
      </div>
    </div>
  );
}
