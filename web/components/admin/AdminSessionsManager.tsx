'use client';

import { useCallback, useEffect, useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import ReconnectModal from '@/components/ReconnectModal';
import ConfirmModal from '@/components/ConfirmModal';

type AdminSession = {
  id: string;
  label: string;
  phoneNumber: string;
  status: string;
  gatewayUrl: string;
  shardLabel: string | null;
  createdAt: string;
  user: { email: string };
};

export default function AdminSessionsManager({
  apiUrl = '/api/admin/sessions',
  emptyMessage = 'No sessions exist yet, across any account.',
}: {
  // Lets the shard-detail page (/dashboard/admin/shards/[id]) reuse this
  // exact component scoped to one shard's sessions instead of duplicating
  // the list/disconnect/reconnect/remove logic.
  apiUrl?: string;
  emptyMessage?: string;
}) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<AdminSession | null>(null);
  const [reconnectTarget, setReconnectTarget] = useState<{
    id: string;
    status: string;
    pairingCode: string | null;
  } | null>(null);

  const fetchSessions = useCallback(async () => {
    const res = await fetch(apiUrl);
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions);
    }
    setLoading(false);
  }, [apiUrl]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  async function handleDisconnect(id: string) {
    setBusyId(id);
    await fetch(`/api/admin/sessions/${id}/disconnect`, { method: 'POST' });
    setBusyId(null);
    fetchSessions();
  }

  async function handleReconnect(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/sessions/${id}/reconnect`, { method: 'POST' });
    const data = await res.json();
    setBusyId(null);
    fetchSessions();
    if (data.status && data.status !== 'connected') {
      setReconnectTarget({ id, status: data.status, pairingCode: data.pairingCode ?? null });
    }
  }

  async function handleRemove(session: AdminSession) {
    setConfirmingRemove(null);
    setBusyId(session.id);
    await fetch(`/api/admin/sessions/${session.id}`, { method: 'DELETE' });
    setBusyId(null);
    fetchSessions();
  }

  if (loading) return <p className="text-sm text-slate-400">Loading...</p>;

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-surface-border p-10 text-center">
        <p className="text-slate-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((s) => {
        const isLive = s.status === 'connected' || s.status === 'connecting';
        const busy = busyId === s.id;
        return (
          <div
            key={s.id}
            className="rounded-xl border border-surface-border bg-surface-raised p-4 sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-medium">{s.label}</h3>
                <p className="mt-0.5 text-sm text-slate-400">+{s.phoneNumber}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {s.user.email} &middot; {s.shardLabel ? `${s.shardLabel} shard` : s.gatewayUrl}
                </p>
              </div>
              <StatusBadge status={s.status} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {isLive ? (
                <button
                  onClick={() => handleDisconnect(s.id)}
                  disabled={busy}
                  className="rounded-md border border-surface-border px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-surface disabled:opacity-50 sm:py-1.5"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => handleReconnect(s.id)}
                  disabled={busy}
                  className="rounded-md border border-violet-900/50 px-3 py-2 text-xs font-medium text-violet-400 transition hover:bg-violet-950/30 disabled:opacity-50 sm:py-1.5"
                >
                  {busy ? 'Reconnecting...' : 'Reconnect'}
                </button>
              )}
              <button
                onClick={() => setConfirmingRemove(s)}
                disabled={busy}
                className="rounded-md border border-red-900/50 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-950/30 disabled:opacity-50 sm:py-1.5"
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}

      {reconnectTarget && (
        <ReconnectModal
          sessionId={reconnectTarget.id}
          initialStatus={reconnectTarget.status}
          initialPairingCode={reconnectTarget.pairingCode}
          onClose={() => setReconnectTarget(null)}
          statusUrl={`/api/admin/sessions/${reconnectTarget.id}/status`}
        />
      )}

      {confirmingRemove && (
        <ConfirmModal
          title="Remove session"
          message={`Remove "${confirmingRemove.label}" (${confirmingRemove.user.email})? This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={() => handleRemove(confirmingRemove)}
          onCancel={() => setConfirmingRemove(null)}
        />
      )}
    </div>
  );
}
