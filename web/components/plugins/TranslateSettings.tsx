'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

export type TranslateSettingsValue = {
  replyInGroups: boolean;
};

export default function TranslateSettings({
  value,
  onSave,
}: {
  value: TranslateSettingsValue;
  onSave: (value: TranslateSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const { saving, saved, save } = useSaveState(onSave);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Anyone chatting with the bot can send{' '}
        <code className="rounded bg-surface-raised px-1">!tl es hello mom</code> to translate text
        on the spot, or reply to any message with{' '}
        <code className="rounded bg-surface-raised px-1">!tl es</code> to translate that message
        instead. Works with a language code or the full name --{' '}
        <code className="rounded bg-surface-raised px-1">es</code> and{' '}
        <code className="rounded bg-surface-raised px-1">spanish</code> both work. The full word{' '}
        <code className="rounded bg-surface-raised px-1">!translate</code> works too.
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
