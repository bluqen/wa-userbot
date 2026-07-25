'use client';

import { useState } from 'react';
import { personalitiesByCategory, getPersonality } from '@/lib/personalities';
import ExceptionsEditor, { type Exception } from './ExceptionsEditor';

export type AIReplySettingsValue = {
  personalityId: string;
  customPrompt: string;
  replyInGroups: boolean;
  showTyping: boolean;
  typingDurationMs: number;
  cooldownMinutes: number;
  historyLength: number;
  exceptions: Exception[];
};

const GROUPS = personalitiesByCategory();

export default function AIReplySettings({
  value,
  onSave,
}: {
  value: AIReplySettingsValue;
  onSave: (value: AIReplySettingsValue) => Promise<void>;
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

  const isCustom = form.personalityId === 'custom';
  const selected = !isCustom ? getPersonality(form.personalityId) : undefined;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Personality</label>
        <select
          value={form.personalityId}
          onChange={(e) => setForm({ ...form, personalityId: e.target.value })}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
        >
          <option value="custom">Custom...</option>
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
        {selected && <p className="mt-1.5 text-xs text-slate-500">{selected.prompt}</p>}
      </div>

      {isCustom && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Custom personality
          </label>
          <textarea
            value={form.customPrompt}
            onChange={(e) => setForm({ ...form, customPrompt: e.target.value })}
            rows={3}
            placeholder="Describe how it should talk, e.g. 'A sleepy cat who answers in short, lazy sentences.'"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
          />
        </div>
      )}

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

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Chat memory (messages)
        </label>
        <input
          type="number"
          min={0}
          value={form.historyLength}
          onChange={(e) =>
            setForm({ ...form, historyLength: Math.max(0, Number(e.target.value)) })
          }
          className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
        />
        <p className="mt-1 text-xs text-slate-500">
          How many recent messages with a contact to remember for context. 0 = no memory, each
          reply is generated blind.
        </p>
      </div>

      <ExceptionsEditor
        exceptions={form.exceptions || []}
        onChange={(exceptions) => setForm({ ...form, exceptions })}
        defaultOverrides={{ personalityId: form.personalityId, customPrompt: '' }}
        renderOverrides={(overrides, setOverrides) => {
          const overridePersonalityId = (overrides.personalityId as string) || 'friendly-helper';
          const overrideIsCustom = overridePersonalityId === 'custom';
          return (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-400">Personality for this contact</label>
                <select
                  value={overridePersonalityId}
                  onChange={(e) => setOverrides({ ...overrides, personalityId: e.target.value })}
                  className="mt-1 w-full rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs outline-none ring-emerald-500/50 focus:ring-2"
                >
                  <option value="custom">Custom...</option>
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
              </div>
              {overrideIsCustom && (
                <textarea
                  value={(overrides.customPrompt as string) || ''}
                  onChange={(e) => setOverrides({ ...overrides, customPrompt: e.target.value })}
                  rows={2}
                  placeholder="Describe how it should talk with this contact"
                  className="w-full rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs outline-none ring-emerald-500/50 focus:ring-2"
                />
              )}
            </div>
          );
        }}
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
