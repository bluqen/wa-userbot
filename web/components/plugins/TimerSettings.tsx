'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

export type TimerSettingsValue = {
  replyInGroups: boolean;
};

export default function TimerSettings({
  value,
  onSave,
}: {
  value: TimerSettingsValue;
  onSave: (value: TimerSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const { saving, saved, save } = useSaveState(onSave);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Anyone chatting with the bot can send{' '}
        <code className="rounded bg-surface-raised px-1">!timer 5m</code> for a countdown. Five
        minutes or under ticks down live every second as an emoji clock; up to 14 minutes updates
        every few seconds. Longer than that, WhatsApp stops allowing the message to be edited, so
        the bot confirms the timer and sends a fresh &quot;time&apos;s up&quot; message when it
        finishes (up to 24 hours) &mdash; those survive restarts. Combine units like{' '}
        <code className="rounded bg-surface-raised px-1">!timer 1h30m</code>, or just{' '}
        <code className="rounded bg-surface-raised px-1">!timer 90s</code>.
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
