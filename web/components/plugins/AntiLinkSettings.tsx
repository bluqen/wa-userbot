'use client';

import { useState } from 'react';

export type AntiLinkSettingsValue = {
  kickAfterWarnings: number;
};

export default function AntiLinkSettings({
  value,
  onSave,
}: {
  value: AntiLinkSettingsValue;
  onSave: (value: AntiLinkSettingsValue) => Promise<void>;
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
        Deletes messages containing links from non-admins in any group. Requires the bot&apos;s
        WhatsApp account to actually be a group admin there -- otherwise WhatsApp will simply
        refuse the delete/remove request.
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Remove member after this many warnings
        </label>
        <input
          type="number"
          min={0}
          value={form.kickAfterWarnings}
          onChange={(e) =>
            setForm({ ...form, kickAfterWarnings: Math.max(0, Number(e.target.value)) })
          }
          className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
        <p className="mt-1 text-xs text-slate-500">0 = never remove, just delete the link.</p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save settings'}
      </button>
    </div>
  );
}
