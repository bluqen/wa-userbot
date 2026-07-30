'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type AiAskSettingsValue = Record<string, never>;

export default function AiAskSettings() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
      Reply to any message with just{' '}
      <code className="rounded bg-surface-raised px-1">!ai</code> to get an AI answer about it, or
      send <code className="rounded bg-surface-raised px-1">!ai &lt;question&gt;</code> directly.
      Owner-only -- the command message itself is replaced with the answer. A one-off question,
      separate from AI Reply&apos;s ongoing conversation.
    </div>
  );
}
