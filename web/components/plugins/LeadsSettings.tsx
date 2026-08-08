'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';
import LeadsManager from './LeadsManager';

export type LeadsSettingsValue = {
  cooldownMinutes: number;
};

export default function LeadsSettings({
  sessionId,
  value,
  onSave,
}: {
  sessionId: string;
  value: LeadsSettingsValue;
  onSave: (value: LeadsSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const { saving, saved, save } = useSaveState(onSave);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Quietly reads your DMs for useful signals -- a name, what someone needs, their budget,
        their timeline -- and keeps a short private note per contact below. Nothing is ever sent
        to the customer, it&apos;s just for you.
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Minimum minutes between extractions per contact
        </label>
        <input
          type="number"
          min={0}
          value={form.cooldownMinutes}
          onChange={(e) =>
            setForm({ ...form, cooldownMinutes: Math.max(0, Number(e.target.value)) })
          }
          className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      </div>

      <SaveButton saving={saving} saved={saved} onClick={() => save(form)} />

      <LeadsManager sessionId={sessionId} />
    </div>
  );
}
