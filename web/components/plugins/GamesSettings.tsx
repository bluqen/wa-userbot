'use client';

import { useState } from 'react';

export type GamesSettingsValue = {
  replyInGroups: boolean;
};

export default function GamesSettings({
  value,
  onSave,
}: {
  value: GamesSettingsValue;
  onSave: (value: GamesSettingsValue) => Promise<void>;
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
        Commands: <code className="rounded bg-surface-raised px-1">/8ball &lt;question&gt;</code>,{' '}
        <code className="rounded bg-surface-raised px-1">/rps rock|paper|scissors</code>, and{' '}
        <code className="rounded bg-surface-raised px-1">/trivia</code> (answer with{' '}
        <code className="rounded bg-surface-raised px-1">/trivia answer &lt;letter&gt;</code>).
        <br />
        <br />
        Reply to an image with{' '}
        <code className="rounded bg-surface-raised px-1">/meme top text | bottom text</code> for a
        classic meme caption. Reply to a voice note with{' '}
        <code className="rounded bg-surface-raised px-1">/robot</code>,{' '}
        <code className="rounded bg-surface-raised px-1">/deep</code>,{' '}
        <code className="rounded bg-surface-raised px-1">/chipmunk</code>, or{' '}
        <code className="rounded bg-surface-raised px-1">/echo</code> to send it back transformed.
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Allow in group chats
          <span className="block text-xs text-slate-500">Off by default.</span>
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
