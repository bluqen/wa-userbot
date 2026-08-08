'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

export type SudoSettingsValue = {
  numbers: string[];
};

export default function SudoSettings({
  value,
  onSave,
}: {
  value: SudoSettingsValue;
  onSave: (value: SudoSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState<SudoSettingsValue>({ numbers: value.numbers || [] });
  const [draft, setDraft] = useState('');
  const { saving, saved, save } = useSaveState(onSave);

  function addNumber() {
    const digits = draft.replace(/\D/g, '');
    if (!digits || form.numbers.includes(digits)) {
      setDraft('');
      return;
    }
    setForm({ ...form, numbers: [...form.numbers, digits] });
    setDraft('');
  }

  function removeNumber(number: string) {
    setForm({ ...form, numbers: form.numbers.filter((n) => n !== number) });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Numbers listed here can use <code className="rounded bg-surface-raised px-1">!tagall</code>{' '}
        and <code className="rounded bg-surface-raised px-1">!poll</code> on your behalf, even
        though the messages aren&apos;t from your own account. No other commands are available to
        them.
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Trusted numbers
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addNumber();
              }
            }}
            placeholder="e.g. 15551234567"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
          />
          <button
            onClick={addNumber}
            className="shrink-0 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-slate-200 hover:bg-surface"
          >
            Add
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Digits only, with country code, no + or spaces.
        </p>
      </div>

      {form.numbers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {form.numbers.map((n) => (
            <span
              key={n}
              className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface px-3 py-1 text-xs text-slate-300"
            >
              {n}
              <button
                onClick={() => removeNumber(n)}
                className="text-slate-500 hover:text-red-400"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <SaveButton saving={saving} saved={saved} onClick={() => save(form)} />
    </div>
  );
}
