'use client';

import { useState } from 'react';

export type SongSettingsValue = {
  replyInGroups: boolean;
};

export default function SongSettings({
  value,
  onSave,
}: {
  value: SongSettingsValue;
  onSave: (value: SongSettingsValue) => Promise<void>;
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
        Anyone chatting with the bot can message{' '}
        <code className="rounded bg-surface-raised px-1">!song &lt;genre or mood&gt;</code> (e.g.{' '}
        <code className="rounded bg-surface-raised px-1">!song lofi chill</code>) to get back a
        royalty-free track. This only searches Jamendo&apos;s catalog of independent,
        Creative-Commons-licensed music -- not mainstream commercial songs -- and always replies
        with the artist name and license so it can be credited properly.
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Allow in group chats
          <span className="block text-xs text-slate-500">
            Off by default -- a random track landing in a group chat can be more disruptive than
            in a 1:1 chat.
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
