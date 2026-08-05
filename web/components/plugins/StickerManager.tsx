'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LoadingDots from '@/components/LoadingDots';

type Sticker = {
  id: string;
  tag: string;
  mimetype: string;
  data: string;
  createdAt: string;
};

export default function StickerManager({ sessionId }: { sessionId: string }) {
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<Sticker | null>(null);

  const fetchStickers = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/stickers`);
    if (res.ok) {
      const data = await res.json();
      setStickers(data.stickers);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    fetchStickers();
  }, [fetchStickers]);

  async function handleDelete(stickerId: string) {
    setConfirmingDelete(null);
    await fetch(`/api/sessions/${sessionId}/stickers/${encodeURIComponent(stickerId)}`, {
      method: 'DELETE',
    });
    fetchStickers();
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">Saved stickers</label>
      <p className="mb-2 text-xs text-slate-500">
        Taught via WhatsApp itself -- reply to a sticker message with{' '}
        <code className="rounded bg-surface px-1">!savesticker &lt;tag&gt;</code>.
      </p>

      {loading ? (
        <LoadingDots />
      ) : stickers.length === 0 ? (
        <p className="text-xs text-slate-500">No stickers saved yet.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {stickers.map((s) => (
            <div
              key={s.id}
              className="flex w-20 flex-col items-center gap-1 rounded-lg border border-surface-border bg-surface p-2"
            >
              <img
                src={`data:${s.mimetype};base64,${s.data}`}
                alt={s.tag}
                className="h-12 w-12 object-contain"
              />
              <span className="w-full truncate text-center text-xs text-slate-300" title={s.tag}>
                {s.tag}
              </span>
              <button
                onClick={() => setConfirmingDelete(s)}
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
          title="Remove sticker"
          message={`Remove this "${confirmingDelete.tag}" sticker? This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={() => handleDelete(confirmingDelete.id)}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
}
