'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LoadingDots from '@/components/LoadingDots';

type Note = {
  id: string;
  name: string;
  kind: 'text' | 'media';
  text: string;
  mediaType: string | null;
  mimetype: string | null;
  fileName: string | null;
  data: string | null; // base64, only present for image/sticker previews
  createdAt: string;
};

const MEDIA_ICONS: Record<string, string> = {
  videoMessage: '🎬',
  audioMessage: '🎧',
  documentMessage: '📄',
};

export default function NotesManager({ sessionId }: { sessionId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<Note | null>(null);

  const fetchNotes = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/notes`);
    if (res.ok) {
      const data = await res.json();
      setNotes(data.notes);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  async function handleDelete(noteId: string) {
    setConfirmingDelete(null);
    await fetch(`/api/sessions/${sessionId}/notes/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
    });
    fetchNotes();
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">Saved notes</label>
      <p className="mb-2 text-xs text-slate-500">
        Saved via WhatsApp itself -- reply to any message with{' '}
        <code className="rounded bg-surface px-1">!savenote &lt;name&gt;</code>, then recall it
        anywhere with <code className="rounded bg-surface px-1">#name</code>.
      </p>

      {loading ? (
        <LoadingDots />
      ) : notes.length === 0 ? (
        <p className="text-xs text-slate-500">No notes saved yet.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {notes.map((n) => (
            <div
              key={n.id}
              className="flex w-24 flex-col items-center gap-1 rounded-lg border border-surface-border bg-surface p-2"
            >
              {n.data ? (
                <img
                  src={`data:${n.mimetype};base64,${n.data}`}
                  alt={n.name}
                  className="h-12 w-12 object-contain"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center text-2xl">
                  {n.kind === 'media' ? MEDIA_ICONS[n.mediaType || ''] || '📎' : '📝'}
                </div>
              )}
              <span className="w-full truncate text-center text-xs text-slate-300" title={n.name}>
                #{n.name}
              </span>
              {n.kind === 'text' && (
                <span
                  className="w-full truncate text-center text-[10px] text-slate-500"
                  title={n.text}
                >
                  {n.text}
                </span>
              )}
              <button
                onClick={() => setConfirmingDelete(n)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Remove note"
          message={`Remove the "#${confirmingDelete.name}" note? This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={() => handleDelete(confirmingDelete.id)}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
}
