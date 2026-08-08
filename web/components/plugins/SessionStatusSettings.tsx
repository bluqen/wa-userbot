'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type SessionStatusSettingsValue = Record<string, never>;

export default function SessionStatusSettings() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
      Owner-only. Send <code className="rounded bg-surface-raised px-1">!status</code> to see this
      session&apos;s own connection, uptime, and plugin count &mdash; useful for checking whether a
      command&apos;s actually enabled without opening the dashboard.
      <p className="mt-2">
        If your account is an admin on this website,{' '}
        <code className="rounded bg-surface-raised px-1">!status all</code> also shows every shard:
        how many sessions each has and whether they&apos;re paired to their own plugin engine.
      </p>
    </div>
  );
}
