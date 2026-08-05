'use client';

import { useState } from 'react';

export default function ShardPluginEngineEditor({
  shardId,
  initialValue,
}: {
  shardId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/admin/shards/${shardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginEngineUrl: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
      <label className="mb-1.5 block text-sm font-medium text-slate-300">Plugin engine URL</label>
      <p className="mb-2 text-xs text-slate-500">
        The plugin-engine instance this shard is paired with. Leave blank if it shares the default
        instance set on the gateway itself -- this field is only for the admin panel to display
        and manage the pairing, changing it here doesn&apos;t change what the gateway actually
        calls (that&apos;s set by that service&apos;s own <code>PLUGIN_ENGINE_URL</code>
        environment variable in Render).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://wa-bot-plugins-2.onrender.com"
          className="min-w-[240px] flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
