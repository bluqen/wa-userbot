'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type PollsSettingsValue = Record<string, never>;

export default function PollsSettings() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
      Inside any chat, send{' '}
      <code className="rounded bg-surface-raised px-1">
        !poll question | option1 | option2
      </code>{' '}
      (up to 12 options, separated by <code className="rounded bg-surface-raised px-1">|</code>)
      to create a native WhatsApp poll.
    </div>
  );
}
