'use client';

import { useState } from 'react';
import Link from 'next/link';
import StatusBadge from './StatusBadge';
import ReconnectModal from './ReconnectModal';
import ConfirmModal from './ConfirmModal';

export type WaSession = {
  id: string;
  label: string;
  phoneNumber: string;
  status: string;
  createdAt: string;
};

export default function SessionCard({
  session,
  onDisconnect,
  onRemove,
  onReconnect,
}: {
  session: WaSession;
  onDisconnect: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onReconnect: (id: string) => Promise<{ status: string; pairingCode: string | null }>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [reconnectResult, setReconnectResult] = useState<{
    status: string;
    pairingCode: string | null;
  } | null>(null);
  const isLive = session.status === 'connected' || session.status === 'connecting';

  async function handleDisconnect() {
    setBusy(true);
    await onDisconnect(session.id);
    setBusy(false);
  }

  async function handleRemove() {
    setConfirmingRemove(false);
    setBusy(true);
    await onRemove(session.id);
    setBusy(false);
  }

  async function handleReconnect() {
    setBusy(true);
    const result = await onReconnect(session.id);
    setBusy(false);
    // Only pop the modal if a fresh pairing code was actually needed --
    // if it just reconnected cleanly, the status badge update is enough.
    if (result.status !== 'connected') {
      setReconnectResult(result);
    }
  }

  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">{session.label}</h3>
          <p className="mt-0.5 text-sm text-slate-400">+{session.phoneNumber}</p>
        </div>
        <StatusBadge status={session.status} />
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href={`/dashboard/sessions/${session.id}/plugins`}
          className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-surface"
        >
          Plugins
        </Link>
        {isLive ? (
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-surface disabled:opacity-50"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleReconnect}
            disabled={busy}
            className="rounded-md border border-emerald-900/50 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-950/30 disabled:opacity-50"
          >
            {busy ? 'Reconnecting...' : 'Reconnect'}
          </button>
        )}
        <button
          onClick={() => setConfirmingRemove(true)}
          disabled={busy}
          className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-950/30 disabled:opacity-50"
        >
          Remove
        </button>
      </div>

      {reconnectResult && (
        <ReconnectModal
          sessionId={session.id}
          initialStatus={reconnectResult.status}
          initialPairingCode={reconnectResult.pairingCode}
          onClose={() => setReconnectResult(null)}
        />
      )}

      {confirmingRemove && (
        <ConfirmModal
          title="Remove session"
          message={`Remove "${session.label}"? This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </div>
  );
}
