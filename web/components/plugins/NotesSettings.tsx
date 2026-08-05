'use client';

import NotesManager from './NotesManager';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info + the saved-notes
// list/delete UI.
export type NotesSettingsValue = Record<string, never>;

export default function NotesSettings({ sessionId }: { sessionId: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Reply directly to any message -- text, image, video, voice note, sticker, or document --
        with <code className="rounded bg-surface-raised px-1">!savenote &lt;name&gt;</code> to save
        it. Later, typing <code className="rounded bg-surface-raised px-1">#name</code> anywhere
        in a message drops that saved content into whichever conversation you&apos;re in.
      </div>

      <NotesManager sessionId={sessionId} />
    </div>
  );
}
