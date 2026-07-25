'use client';

import { useEffect, useState } from 'react';

export default function ReconnectModal({
  sessionId,
  initialStatus,
  initialPairingCode,
  onClose,
}: {
  sessionId: string;
  initialStatus: string;
  initialPairingCode: string | null;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [pairingCode, setPairingCode] = useState(initialPairingCode);

  useEffect(() => {
    if (status === 'connected') return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/sessions/${sessionId}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
        if (data.pairingCode) setPairingCode(data.pairingCode);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionId, status]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-surface-border bg-surface-raised p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Reconnect</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        {status === 'connected' ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-4 text-sm text-emerald-300">
              Reconnected! This session is live again.
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        ) : pairingCode ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-slate-400">
              We couldn&apos;t automatically restore the connection -- the device may have been
              unlinked. Open WhatsApp &rarr; Linked Devices &rarr; Link a device &rarr; Link with
              phone number instead, then enter:
            </p>
            <p className="text-3xl font-bold tracking-widest">{pairingCode}</p>
            <p className="text-xs text-slate-500">Status: {status}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Trying to reconnect using the saved session...</p>
        )}
      </div>
    </div>
  );
}
