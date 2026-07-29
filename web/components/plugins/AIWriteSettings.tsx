'use client';

import { useState } from 'react';
import { personalitiesByCategory, getPersonality } from '@/lib/personalities';

export type AIWriteSettingsValue = {
  styleId: string;
  customStylePrompt: string;
  extraInstructions: string;
  applyInGroups: boolean;
  minLength: number;
  cooldownMinutes: number;
};

const GROUPS = personalitiesByCategory();

export default function AIWriteSettings({
  value,
  onSave,
}: {
  value: AIWriteSettingsValue;
  onSave: (value: AIWriteSettingsValue) => Promise<void>;
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

  const isCustom = form.styleId === 'custom';
  const selected =
    form.styleId !== 'fix-errors' && form.styleId !== 'custom' ? getPersonality(form.styleId) : undefined;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Style</label>
        <select
          value={form.styleId}
          onChange={(e) => setForm({ ...form, styleId: e.target.value })}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        >
          <option value="fix-errors">Just fix errors</option>
          <option value="custom">Custom style...</option>
          {GROUPS.map((group) => (
            <optgroup key={group.category} label={group.category}>
              {group.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {form.styleId === 'fix-errors' && (
          <p className="mt-1.5 text-xs text-slate-500">
            Keeps your wording and tone -- only fixes spelling and grammar mistakes.
          </p>
        )}
        {selected && (
          <p className="mt-1.5 text-xs text-slate-500">
            Fixes mistakes, then rewrites in this style: {selected.prompt}
          </p>
        )}
      </div>

      {isCustom && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Custom style</label>
          <textarea
            value={form.customStylePrompt}
            onChange={(e) => setForm({ ...form, customStylePrompt: e.target.value })}
            rows={2}
            placeholder="e.g. 'Make it sound more confident and to the point.'"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
          />
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Extra instructions (optional)
        </label>
        <textarea
          value={form.extraInstructions}
          onChange={(e) => setForm({ ...form, extraInstructions: e.target.value })}
          rows={2}
          placeholder="e.g. 'Never use emojis' or 'keep it under two sentences' -- layered on top of the style above."
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Apply in group chats
          <span className="block text-xs text-slate-500">
            Off by default -- editing your own messages in groups is more visible if something
            goes wrong.
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.applyInGroups}
          onChange={(e) => setForm({ ...form, applyInGroups: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Minimum message length
        </label>
        <input
          type="number"
          min={0}
          value={form.minLength}
          onChange={(e) => setForm({ ...form, minLength: Math.max(0, Number(e.target.value)) })}
          className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
        <p className="mt-1 text-xs text-slate-500">
          Skips short messages like &quot;ok&quot; or a single emoji, where an edit isn&apos;t
          worth it.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Cooldown per chat (minutes)
        </label>
        <input
          type="number"
          min={0}
          value={form.cooldownMinutes}
          onChange={(e) => setForm({ ...form, cooldownMinutes: Math.max(0, Number(e.target.value)) })}
          className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
        <p className="mt-1 text-xs text-slate-500">
          0 = every message gets a chance at editing. Otherwise, skips further edits in the same
          chat until this many minutes have passed since the last attempt -- useful if you're
          hitting AI provider rate limits from a burst of your own messages.
        </p>
      </div>

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
