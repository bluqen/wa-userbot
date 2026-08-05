'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LoadingDots from '@/components/LoadingDots';

type Broadcast = {
  batchId: string;
  message: string;
  runAt: string;
  total: number;
  sent: number;
};

type BroadcastGroup = {
  id: string;
  name: string;
  groupName: string;
};

export default function BroadcastsManager({ sessionId }: { sessionId: string }) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [groups, setGroups] = useState<BroadcastGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [recipients, setRecipients] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [sendAt, setSendAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);

  const fetchBroadcasts = useCallback(async () => {
    const [broadcastsRes, groupsRes] = await Promise.all([
      fetch(`/api/sessions/${sessionId}/broadcasts`),
      fetch(`/api/sessions/${sessionId}/broadcast-groups`),
    ]);
    if (broadcastsRes.ok) {
      const data = await broadcastsRes.json();
      setBroadcasts(data.broadcasts || []);
    }
    if (groupsRes.ok) {
      const data = await groupsRes.json();
      setGroups(data.groups || []);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    fetchBroadcasts();
  }, [fetchBroadcasts]);

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  }

  async function handleSend() {
    setError(null);
    const recipientList = recipients
      .split(/[\n,]/)
      .map((r) => r.trim())
      .filter(Boolean);

    if (!message.trim() || (recipientList.length === 0 && selectedGroupIds.length === 0)) {
      setError('A message and at least one recipient or group are required.');
      return;
    }

    setSubmitting(true);
    const res = await fetch(`/api/sessions/${sessionId}/broadcasts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        recipients: recipientList,
        groupIds: selectedGroupIds,
        sendAt: sendAt ? new Date(sendAt).toISOString() : null,
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to schedule broadcast');
      return;
    }

    setMessage('');
    setRecipients('');
    setSelectedGroupIds([]);
    setSendAt('');
    fetchBroadcasts();
  }

  async function handleCancel(batchId: string) {
    setConfirmingCancel(null);
    await fetch(`/api/sessions/${sessionId}/broadcasts/${batchId}`, { method: 'DELETE' });
    fetchBroadcasts();
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="What do you want to send?"
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Recipients (one per line, or comma-separated)
        </label>
        <textarea
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          rows={3}
          placeholder={'15551234567\n15559998888'}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Groups {groups.length === 0 && <span className="font-normal text-slate-500">(none tagged yet)</span>}
        </label>
        <p className="mb-2 text-xs text-slate-500">
          Send <code className="rounded bg-surface px-1">!addbroadcast &lt;name&gt;</code> inside a
          group to tag it for broadcasts -- no need to know its number.
        </p>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <label
                key={g.id}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition ${
                  selectedGroupIds.includes(g.id)
                    ? 'border-violet-500 bg-violet-950/40 text-violet-300'
                    : 'border-surface-border text-slate-400 hover:bg-surface'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedGroupIds.includes(g.id)}
                  onChange={() => toggleGroup(g.id)}
                  className="sr-only"
                />
                {g.groupName || g.name} <span className="opacity-60">#{g.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Send at (optional -- blank sends as soon as possible)
        </label>
        <input
          type="datetime-local"
          value={sendAt}
          onChange={(e) => setSendAt(e.target.value)}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={handleSend}
        disabled={submitting}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
      >
        {submitting ? 'Scheduling...' : 'Schedule broadcast'}
      </button>

      <div className="border-t border-surface-border pt-4">
        <h3 className="mb-2 text-sm font-medium text-slate-300">Broadcasts</h3>
        {loading ? (
          <LoadingDots />
        ) : broadcasts.length === 0 ? (
          <p className="text-xs text-slate-500">No broadcasts yet.</p>
        ) : (
          <div className="space-y-2">
            {broadcasts.map((b) => (
              <div
                key={b.batchId}
                className="flex items-start justify-between gap-3 rounded-lg border border-surface-border bg-surface p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{b.message}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {new Date(b.runAt).toLocaleString()} &middot; {b.sent}/{b.total} sent
                  </p>
                </div>
                {b.sent < b.total && (
                  <button
                    onClick={() => setConfirmingCancel(b.batchId)}
                    className="shrink-0 text-xs text-red-400 hover:text-red-300"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmingCancel && (
        <ConfirmModal
          title="Cancel broadcast"
          message="Cancel every not-yet-sent recipient in this broadcast? Already-sent messages aren't affected."
          confirmLabel="Cancel broadcast"
          onConfirm={() => handleCancel(confirmingCancel)}
          onCancel={() => setConfirmingCancel(null)}
        />
      )}
    </div>
  );
}
