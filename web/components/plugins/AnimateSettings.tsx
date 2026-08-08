'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type AnimateSettingsValue = Record<string, never>;

const ANIMATIONS = [
  'happy',
  'love',
  'fire',
  'party',
  'boom',
  'cool',
  'sad',
  'think',
  'wave',
  'loading',
];

export default function AnimateSettings() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Owner-only. Send <code className="rounded bg-surface-raised px-1">..happy</code> from your
        own account and that message animates itself in place &mdash; it can only ever change your
        own messages, never anyone else&apos;s.
      </div>

      <div className="rounded-lg border border-surface-border bg-surface p-3">
        <p className="mb-2 text-xs font-medium text-slate-300">Available</p>
        <div className="flex flex-wrap gap-1.5">
          {ANIMATIONS.map((name) => (
            <code key={name} className="rounded bg-surface-raised px-1.5 py-0.5 text-xs text-slate-300">
              ..{name}
            </code>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Typing <code className="rounded bg-surface-raised px-1">..</code> with a name that
          doesn&apos;t exist replaces the message with this list instead.
        </p>
      </div>
    </div>
  );
}
