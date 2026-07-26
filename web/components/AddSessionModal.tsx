'use client';

import { useEffect, useState, type FormEvent } from 'react';

export default function AddSessionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId || status === 'connected') return;

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, phoneNumber }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to create session');
      return;
    }

    const data = await res.json();
    setSessionId(data.session.id);
    setStatus(data.session.status);
    setPairingCode(data.pairingCode);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-surface-border bg-surface-raised p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a WhatsApp session</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        {status === 'connected' ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-4 text-sm text-emerald-300">
              Connected! This number is now live.
            </div>
            <button
              onClick={onCreated}
              className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        ) : pairingCode ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-slate-400">
              Open WhatsApp &rarr; Linked Devices &rarr; Link a device &rarr; Link with phone
              number instead, then enter:
            </p>
            <p className="text-3xl font-bold tracking-widest">{pairingCode}</p>
            <p className="text-xs text-slate-500">Status: {status}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Label (optional)
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Business number"
                className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Phone number
              </label>
              <input
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Country code + number, e.g. 15551234567"
                className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? 'Requesting code...' : 'Get pairing code'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
