'use client';

// Pairs with useSaveState (web/lib/useSaveState.ts) -- the identical
// button JSX every plugin settings component had copy-pasted alongside
// its identical saving/saved state.
export default function SaveButton({
  saving,
  saved,
  onClick,
}: {
  saving: boolean;
  saved: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
    >
      {saving ? 'Saving...' : saved ? 'Saved!' : 'Save settings'}
    </button>
  );
}
