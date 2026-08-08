'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

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
  const { saving, saved, save } = useSaveState(onSave);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Commands: <code className="rounded bg-surface-raised px-1">!8ball &lt;question&gt;</code>,{' '}
        <code className="rounded bg-surface-raised px-1">!rps rock|paper|scissors</code>, and{' '}
        <code className="rounded bg-surface-raised px-1">!trivia</code> (answer with{' '}
        <code className="rounded bg-surface-raised px-1">!trivia answer &lt;letter&gt;</code>).
        <br />
        <br />
        Send <code className="rounded bg-surface-raised px-1">!meme</code> for a random meme, or{' '}
        <code className="rounded bg-surface-raised px-1">!meme wholesomememes</code> to pull from a
        specific subreddit. Reply to a voice note with{' '}
        <code className="rounded bg-surface-raised px-1">!robot</code>,{' '}
        <code className="rounded bg-surface-raised px-1">!deep</code>,{' '}
        <code className="rounded bg-surface-raised px-1">!chipmunk</code>, or{' '}
        <code className="rounded bg-surface-raised px-1">!echo</code> to send it back transformed.
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

      <SaveButton saving={saving} saved={saved} onClick={() => save(form)} />
    </div>
  );
}
