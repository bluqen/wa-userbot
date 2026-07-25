'use client';

import { useState } from 'react';
import ExceptionsEditor, { type Exception } from './ExceptionsEditor';

export type AutoReplySettingsValue = {
  message: string;
  replyInGroups: boolean;
  showTyping: boolean;
  typingDurationMs: number;
  cooldownMinutes: number;
  exceptions: Exception[];
};

export default function AutoReplySettings({
  value,
  onSave,
}: {
  value: AutoReplySettingsValue;
  onSave: (value: AutoReplySettingsValue) => Promise<void>;
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
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Reply message</label>
        <textarea
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
        />
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Reply in group chats
          <span className="block text-xs text-slate-500">
            Off by default -- most bots should only auto-reply to DMs.
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.replyInGroups}
          onChange={(e) => setForm({ ...form, replyInGroups: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Show typing indicator
          <span className="block text-xs text-slate-500">
            Looks more natural -- appears to type before sending the reply.
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.showTyping}
          onChange={(e) => setForm({ ...form, showTyping: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>

      {form.showTyping && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Typing duration (seconds)
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={form.typingDurationMs / 1000}
            onChange={(e) =>
              setForm({ ...form, typingDurationMs: Math.max(0, Number(e.target.value)) * 1000 })
            }
            className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
          />
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Cooldown per contact (minutes)
        </label>
        <input
          type="number"
          min={0}
          value={form.cooldownMinutes}
          onChange={(e) => setForm({ ...form, cooldownMinutes: Math.max(0, Number(e.target.value)) })}
          className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
        />
        <p className="mt-1 text-xs text-slate-500">
          0 = always reply. Otherwise, won&apos;t auto-reply to the same contact again until this
          many minutes have passed.
        </p>
      </div>

      <ExceptionsEditor
        exceptions={form.exceptions || []}
        onChange={(exceptions) => setForm({ ...form, exceptions })}
        defaultOverrides={{ message: '' }}
        renderOverrides={(overrides, setOverrides) => (
          <div>
            <label className="text-xs text-slate-400">Custom message (optional)</label>
            <textarea
              value={(overrides.message as string) || ''}
              onChange={(e) => setOverrides({ ...overrides, message: e.target.value })}
              rows={2}
              placeholder="Leave blank to use the default message above"
              className="mt-1 w-full rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs outline-none ring-emerald-500/50 focus:ring-2"
            />
          </div>
        )}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save settings'}
      </button>
    </div>
  );
}
