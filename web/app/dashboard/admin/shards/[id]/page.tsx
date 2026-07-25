import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';
import AdminSessionsManager from '@/components/admin/AdminSessionsManager';

export default async function ShardDetailPage({ params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) notFound();

  const shard = await prisma.gatewayShard.findUnique({ where: { id: params.id } });
  if (!shard) notFound();

  return (
    <div>
      <Link href="/dashboard/admin/shards" className="text-sm text-slate-400 hover:text-slate-200">
        &larr; Back to shards
      </Link>
      <h1 className="mt-2 text-xl font-semibold capitalize">{shard.label || shard.url}</h1>
      <p className="mt-1 text-sm text-slate-400">{shard.url}</p>
      <div className="mt-6">
        <AdminSessionsManager
          apiUrl={`/api/admin/shards/${shard.id}/sessions`}
          emptyMessage="No sessions are assigned to this shard."
        />
      </div>
    </div>
  );
}
