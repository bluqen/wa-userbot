'use client';

import { useState } from 'react';
import { personalitiesByCategory, getPersonality } from '@/lib/personalities';
import ExceptionsEditor, { type Exception } from './ExceptionsEditor';
import StickerManager from './StickerManager';

export type AIReplySettingsValue = {
  personalityId: string;
  customPrompt: string;
  knowledgeBase: string;
  replyInGroups: boolean;
  showTyping: boolean;
  typingDurationMs: number;
  cooldownMinutes: number;
  historyLength: number;
  allowBlocking: boolean;
  blockDurationHours: number;
  humanlikeness: number;
  useSticker: boolean;
  stickerChance: number;
  exceptions: Exception[];
};

const GROUPS = personalitiesByCategory();

const HUMANLIKENESS_LEVELS = [
  {
    value: 0,
    label: 'Off',
    description: 'Consistent timing, always a single plain reply -- today’s default behavior.',
  },
  {
    value: 25,
    label: 'Subtle',
    description: 'Slightly varied reply timing. Rarely swipe-replies or splits a reply in two.',
  },
  {
    value: 50,
    label: 'Natural',
    description: 'Noticeably varied timing, and regularly swipe-replies or splits a reply in two.',
  },
  {
    value: 75,
    label: 'Expressive',
    description: 'Wide timing swings, and frequently swipe-replies or splits a reply in two.',
  },
  {
    value: 100,
    label: 'Maximum',
    description: 'Widest possible timing swings, swipe replies, and reply-splitting -- hardest to tell apart from a person typing.',
  },
] as const;

function closestHumanlikenessLevel(value: number) {
  return HUMANLIKENESS_LEVELS.reduce((closest, level) =>
    Math.abs(level.value - value) < Math.abs(closest.value - value) ? level : closest,
  );
}

export default function AIReplySettings({
  sessionId,
  value,
  onSave,
}: {
  sessionId: string;
  value: AIReplySettingsValue;
  onSave: (value: AIReplySettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState({ ...value, knowledgeBase: value.knowledgeBase ?? '' });
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

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Knowledge base (optional)
        </label>
        <textarea
          value={form.knowledgeBase}
          onChange={(e) => setForm({ ...form, knowledgeBase: e.target.value.slice(0, 4000) })}
          rows={5}
          maxLength={4000}
          placeholder="Paste FAQs, business hours, pricing, policies -- anything the bot should know to answer questions accurately, beyond just its personality."
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
        />
        <p className="mt-1 text-xs text-slate-500">
          {form.knowledgeBase.length}/4000 characters. Given to the AI as reference info for every
          reply -- it'll fall back to the personality above for anything not covered here.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-300">Humanlikeness</label>
          <span className="text-xs font-medium text-emerald-400">
            {closestHumanlikenessLevel(form.humanlikeness).label}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={25}
          value={form.humanlikeness}
          onChange={(e) => setForm({ ...form, humanlikeness: Number(e.target.value) })}
          className="w-full accent-emerald-500"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          {HUMANLIKENESS_LEVELS.map((level) => (
            <span key={level.value}>{level.label}</span>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {closestHumanlikenessLevel(form.humanlikeness).description}
        </p>
      </div>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Allow sending stickers
          <span className="block text-xs text-slate-500">
            Lets the AI send a saved sticker alongside a reply when it fits. Does nothing until
            you&apos;ve saved at least one (see below).
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.useSticker}
          onChange={(e) => setForm({ ...form, useSticker: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>

      {form.useSticker && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-medium text-slate-300">Sticker chance</label>
            <span className="text-xs text-slate-400">{form.stickerChance}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={form.stickerChance}
            onChange={(e) => setForm({ ...form, stickerChance: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            0 = never (default). How often a reply might include a sticker, when one genuinely
            fits.
          </p>
        </div>
      )}

      <StickerManager sessionId={sessionId} />

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

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          Allow AI to block abusive contacts
          <span className="block text-xs text-slate-500">
            Off by default. When on, the AI may end a conversation by blocking the contact if
            they&apos;re abusive or harassing -- no human confirmation in the loop.
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.allowBlocking}
          onChange={(e) => setForm({ ...form, allowBlocking: e.target.checked })}
          className="h-4 w-4 shrink-0"
        />
      </label>

      {form.allowBlocking && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Auto-unblock after (hours)
          </label>
          <input
            type="number"
            min={0}
            value={form.blockDurationHours}
            onChange={(e) =>
              setForm({ ...form, blockDurationHours: Math.max(0, Number(e.target.value)) })
            }
            className="w-24 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring-2"
          />
          <p className="mt-1 text-xs text-slate-500">0 = block permanently.</p>
        </div>
      )}

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
              <label className="flex items-center justify-between text-xs text-slate-400">
                <span>Allow stickers with this contact</span>
                <input
                  type="checkbox"
                  checked={overrides.useSticker !== false}
                  onChange={(e) =>
                    setOverrides({
                      ...overrides,
                      useSticker: e.target.checked ? undefined : false,
                    })
                  }
                  className="h-3.5 w-3.5"
                />
              </label>
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
