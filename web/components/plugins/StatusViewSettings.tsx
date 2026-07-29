'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type StatusViewSettingsValue = Record<string, never>;

export default function StatusViewSettings() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
      Automatically marks every contact&apos;s WhatsApp Status update as viewed as soon as it comes
      in -- no need to open Status manually to keep up with everyone.
    </div>
  );
}
