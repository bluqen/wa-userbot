'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type MediaConvertSettingsValue = Record<string, never>;

export default function MediaConvertSettings() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
      Owner-only. Reply to an image or video/gif with{' '}
      <code className="rounded bg-surface-raised px-1">!sticker</code> to turn it into a sticker.
      Reply to a sticker with <code className="rounded bg-surface-raised px-1">!img</code> to get
      a plain image back, or <code className="rounded bg-surface-raised px-1">!gif</code> to get a
      video back (only works on an animated sticker).
    </div>
  );
}
