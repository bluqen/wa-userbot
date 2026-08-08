'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

export type ImagineSettingsValue = {
  replyInGroups: boolean;
};

export default function ImagineSettings({
  value,
  onSave,
}: {
  value: ImagineSettingsValue;
  onSave: (value: ImagineSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const { saving, saved, save } = useSaveState(onSave);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Anyone chatting with the bot can send{' '}
        <code className="rounded bg-surface-raised px-1">!imagine a cat wearing sunglasses</code>{' '}
        and get back a picture made just for them. Works right away, nothing to set up.
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Allow in group chats
          <span className="block text-xs text-slate-500">
            Off by default -- an AI image landing in a group chat can be more disruptive than in a
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

      <SaveButton saving={saving} saved={saved} onClick={() => save(form)} />
    </div>
  );
}
