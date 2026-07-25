'use client';

import { useCallback, useEffect, useState } from 'react';
import AddSessionModal from '@/components/AddSessionModal';
import SessionCard, { type WaSession } from '@/components/SessionCard';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  async function handleDisconnect(id: string) {
    await fetch(`/api/sessions/${id}/disconnect`, { method: 'POST' });
    fetchSessions();
  }

  async function handleRemove(id: string) {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    fetchSessions();
  }

  async function handleReconnect(id: string) {
    const res = await fetch(`/api/sessions/${id}/reconnect`, { method: 'POST' });
    const data = await res.json();
    fetchSessions();
    return { status: data.status ?? 'none', pairingCode: data.pairingCode ?? null };
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sessions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage the WhatsApp numbers linked to your account.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
        >
          + Add session
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-border p-10 text-center">
          <p className="text-slate-400">No sessions yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              onDisconnect={handleDisconnect}
              onRemove={handleRemove}
              onReconnect={handleReconnect}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <AddSessionModal
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            fetchSessions();
          }}
        />
      )}
    </div>
  );
}
