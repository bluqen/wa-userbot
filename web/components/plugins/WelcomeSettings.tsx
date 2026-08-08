'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

export type WelcomeSettingsValue = {
  welcomeEnabled: boolean;
  goodbyeEnabled: boolean;
  welcomeMessage: string;
  goodbyeMessage: string;
};

export default function WelcomeSettings({
  value,
  onSave,
}: {
  value: WelcomeSettingsValue;
  onSave: (value: WelcomeSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const { saving, saved, save } = useSaveState(onSave);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Use <code className="rounded bg-surface-raised px-1">{'{user}'}</code> and{' '}
        <code className="rounded bg-surface-raised px-1">{'{group}'}</code> in your messages --
        they get replaced with the actual member and group name.
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>Greet new members</span>
        <input
          type="checkbox"
          checked={form.welcomeEnabled}
          onChange={(e) => setForm({ ...form, welcomeEnabled: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>
      {form.welcomeEnabled && (
        <textarea
          value={form.welcomeMessage}
          onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      )}

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>Say goodbye when someone leaves</span>
        <input
          type="checkbox"
          checked={form.goodbyeEnabled}
          onChange={(e) => setForm({ ...form, goodbyeEnabled: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>
      {form.goodbyeEnabled && (
        <textarea
          value={form.goodbyeMessage}
          onChange={(e) => setForm({ ...form, goodbyeMessage: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      )}

      <SaveButton saving={saving} saved={saved} onClick={() => save(form)} />
    </div>
  );
}
