'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

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
  const { saving, saved, save } = useSaveState(onSave);

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

      <SaveButton saving={saving} saved={saved} onClick={() => save(form)} />
    </div>
  );
}
