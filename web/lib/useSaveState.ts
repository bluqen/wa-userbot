import { useState } from 'react';

// The saving/saved/auto-clear sequence every plugin settings component
// repeats by hand: mark saving, call onSave, mark saved, clear "saved"
// after a couple seconds so the button doesn't say "Saved!" forever.
// Sixteen components had this copy-pasted verbatim (down to the exact
// 2000ms) before this existed.
const SAVED_INDICATOR_MS = 2000;

export function useSaveState<T>(onSave: (value: T) => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(value: T) {
    setSaving(true);
    setSaved(false);
    await onSave(value);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), SAVED_INDICATOR_MS);
  }

  return { saving, saved, save };
}
