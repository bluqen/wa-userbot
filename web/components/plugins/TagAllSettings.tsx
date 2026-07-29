'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type TagAllSettingsValue = Record<string, never>;

export default function TagAllSettings() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
      Inside any group, send{' '}
      <code className="rounded bg-surface-raised px-1">/tagall &lt;message&gt;</code> to mention
      every member. The command itself is replaced with your message, mentioning the whole group.
    </div>
  );
}
