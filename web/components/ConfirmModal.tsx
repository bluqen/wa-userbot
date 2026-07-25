'use client';

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-surface-border bg-surface-raised p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-surface"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-950/30"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
