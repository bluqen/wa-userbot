'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import ConfirmModal from '@/components/ConfirmModal';

type GatewayShard = {
  id: string;
  url: string;
  label: string | null;
  active: boolean;
  createdAt: string;
};

export default function ShardsManager() {
  const [shards, setShards] = useState<GatewayShard[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const fetchShards = useCallback(async () => {
    const res = await fetch('/api/admin/shards');
    if (res.ok) {
      const data = await res.json();
      setShards(data.shards);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchShards();
  }, [fetchShards]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const res = await fetch('/api/admin/shards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, label }),
    });

    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to add shard');
      return;
    }

    setUrl('');
    setLabel('');
    fetchShards();
  }

  async function handleToggleActive(shard: GatewayShard) {
    await fetch(`/api/admin/shards/${shard.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !shard.active }),
    });
    fetchShards();
  }

  async function handleDelete(id: string) {
    setConfirmingDelete(null);
    await fetch(`/api/admin/shards/${id}`, { method: 'DELETE' });
    fetchShards();
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-surface-border bg-surface-raised p-4"
      >
        <div className="min-w-[240px] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Gateway URL</label>
          <input
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://wa-bot-gateway.onrender.com"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
          />
        </div>
        <div className="min-w-[160px]">
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Label (optional)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. us-east"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? 'Adding...' : 'Add shard'}
        </button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : shards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-border p-10 text-center">
          <p className="text-slate-400">
            No shards configured -- new sessions fall back to GATEWAY_URL/GATEWAY_SHARD_URLS.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shards.map((shard) => (
            <div
              key={shard.id}
              className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised p-4"
            >
              <div>
                <p className="font-medium">{shard.label || shard.url}</p>
                {shard.label && <p className="mt-0.5 text-sm text-slate-400">{shard.url}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-medium ${shard.active ? 'text-emerald-400' : 'text-slate-500'}`}
                >
                  {shard.active ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => handleToggleActive(shard)}
                  className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-surface"
                >
                  {shard.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => setConfirmingDelete(shard.id)}
                  className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-950/30"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Remove shard"
          message="Remove this shard? New sessions will no longer be assigned to it. Existing sessions already on it are unaffected."
          confirmLabel="Remove"
          onConfirm={() => handleDelete(confirmingDelete)}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
}
