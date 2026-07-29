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
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4 transition hover:border-slate-600 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{session.label}</h3>
          <p className="mt-0.5 text-sm text-slate-400">+{session.phoneNumber}</p>
        </div>
        <StatusBadge status={session.status} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/dashboard/sessions/${session.id}/plugins`}
          className="inline-flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-surface sm:py-1.5"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-3.5 w-3.5 text-white"
          >
            <path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.63-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.6 8.94a.5.5 0 00.12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.14.24.42.32.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.28.27.42.5.42h3.84c.23 0 .45-.14.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.23.09.46.02.6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" />
          </svg>
          Plugins
        </Link>
        {isLive ? (
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="rounded-md border border-surface-border px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-surface disabled:opacity-50 sm:py-1.5"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleReconnect}
            disabled={busy}
            className="rounded-md border border-violet-900/50 px-3 py-2 text-xs font-medium text-violet-400 transition hover:bg-violet-950/30 disabled:opacity-50 sm:py-1.5"
          >
            {busy ? 'Reconnecting...' : 'Reconnect'}
          </button>
        )}
        <button
          onClick={() => setConfirmingRemove(true)}
          disabled={busy}
          className="rounded-md border border-red-900/50 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-950/30 disabled:opacity-50 sm:py-1.5"
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
