'use client';

import { useState } from 'react';

export type QrSettingsValue = {
  replyInGroups: boolean;
};

export default function QrSettings({
  value,
  onSave,
}: {
  value: QrSettingsValue;
  onSave: (value: QrSettingsValue) => Promise<void>;
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
        Anyone chatting with the bot can send{' '}
        <code className="rounded bg-surface-raised px-1">!qr https://your-link.com</code> for a
        plain black-and-white code, add a color like{' '}
        <code className="rounded bg-surface-raised px-1">!qr blue https://your-link.com</code>, or
        two colors for a gradient:{' '}
        <code className="rounded bg-surface-raised px-1">!qr blue orange https://your-link.com</code>
        . Works with any text, not just links.
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Allow in group chats
          <span className="block text-xs text-slate-500">
            Off by default -- a QR code landing in a group chat can be more disruptive than in a
            1:1 chat.
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.replyInGroups}
          onChange={(e) => setForm({ ...form, replyInGroups: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>

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
