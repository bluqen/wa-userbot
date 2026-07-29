'use client';

import { useState } from 'react';
import LeadsManager from './LeadsManager';

export type LeadsSettingsValue = {
  cooldownMinutes: number;
};

export default function LeadsSettings({
  sessionId,
  value,
  onSave,
}: {
  sessionId: string;
  value: LeadsSettingsValue;
  onSave: (value: LeadsSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await onSave(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Reads direct-message conversations for name, need, budget, and timeline signals, and logs
        a short private summary per contact -- nothing is ever sent to the customer. Requires an AI
        provider to be configured, same as AI Reply.
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Minimum minutes between extractions per contact
        </label>
        <input
          type="number"
          min={0}
          value={form.cooldownMinutes}
          onChange={(e) =>
            setForm({ ...form, cooldownMinutes: Math.max(0, Number(e.target.value)) })
          }
          className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save settings'}
      </button>

      <LeadsManager sessionId={sessionId} />
    </div>
  );
}
