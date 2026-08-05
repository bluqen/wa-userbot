'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type AiAskSettingsValue = Record<string, never>;

export default function AiAskSettings() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
      Only you can use this. Reply to any message with{' '}
      <code className="rounded bg-surface-raised px-1">!ai</code> to get an AI answer sent right
      back to you, or type <code className="rounded bg-surface-raised px-1">!ai your question</code>{' '}
      on its own. Prefer a tidier chat? Use{' '}
      <code className="rounded bg-surface-raised px-1">!aie</code> instead and the answer replaces
      your question in place, with no extra message left behind.
    </div>
  );
}
