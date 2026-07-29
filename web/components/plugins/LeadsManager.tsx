'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LoadingDots from '@/components/LoadingDots';

type Lead = {
  id: string;
  contactJid: string;
  summary: string;
  updatedAt: string;
};

function formatContact(jid: string): string {
  return jid.split('@')[0];
}

export default function LeadsManager({ sessionId }: { sessionId: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<Lead | null>(null);

  const fetchLeads = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/leads`);
    if (res.ok) {
      const data = await res.json();
      setLeads(data.leads);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  async function handleDelete(leadId: string) {
    setConfirmingDelete(null);
    await fetch(`/api/sessions/${sessionId}/leads/${encodeURIComponent(leadId)}`, {
      method: 'DELETE',
    });
    fetchLeads();
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">Captured leads</label>
      <p className="mb-2 text-xs text-slate-500">
        Quietly extracted from conversations -- names, needs, budgets, timelines -- for your own
        reference. Never shown to the customer.
      </p>

      {loading ? (
        <LoadingDots />
      ) : leads.length === 0 ? (
        <p className="text-xs text-slate-500">No leads captured yet.</p>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-surface-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-300">{formatContact(lead.contactJid)}</p>
                <p className="mt-0.5 text-xs text-slate-400">{lead.summary}</p>
              </div>
              <button
                onClick={() => setConfirmingDelete(lead)}
                className="shrink-0 text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Remove lead"
          message={`Remove the captured lead for ${formatContact(confirmingDelete.contactJid)}? This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={() => handleDelete(confirmingDelete.id)}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
}
