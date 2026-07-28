'use client';

import { useState } from 'react';

export type AntiDeleteSettingsValue = {
  includeGroups: boolean;
};

export default function AntiDeleteSettings({
  value,
  onSave,
}: {
  value: AntiDeleteSettingsValue;
  onSave: (value: AntiDeleteSettingsValue) => Promise<void>;
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
        When someone deletes a message for everyone, you&apos;ll get a private note in your own
        &quot;Message Yourself&quot; chat with what it said -- it&apos;s never re-posted back into
        the original chat or group, so this only affects what <em>you</em> get to see.
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Include group chats
          <span className="block text-xs text-slate-500">
            Off skips deletions inside groups, so you&apos;ll only be notified about deletions in
            direct messages.
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.includeGroups}
          onChange={(e) => setForm({ ...form, includeGroups: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save settings'}
      </button>
    </div>
  );
}
