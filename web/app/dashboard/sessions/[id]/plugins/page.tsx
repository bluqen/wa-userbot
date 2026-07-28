'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PluginCard from '@/components/plugins/PluginCard';
import AutoReplySettings, {
  type AutoReplySettingsValue,
} from '@/components/plugins/AutoReplySettings';
import AIReplySettings, { type AIReplySettingsValue } from '@/components/plugins/AIReplySettings';
import AIWriteSettings, { type AIWriteSettingsValue } from '@/components/plugins/AIWriteSettings';
import SongSettings, { type SongSettingsValue } from '@/components/plugins/SongSettings';
import AntiDeleteSettings, {
  type AntiDeleteSettingsValue,
} from '@/components/plugins/AntiDeleteSettings';

type PluginConfig = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  settings: Record<string, unknown>;
};

export default function SessionPluginsPage({ params }: { params: { id: string } }) {
  const [plugins, setPlugins] = useState<PluginConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/sessions/${params.id}/plugins`)
      .then((res) => res.json())
      .then((data) => setPlugins(data.plugins || []))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function handleToggle(key: string, enabled: boolean) {
    setPlugins((prev) => prev.map((p) => (p.key === key ? { ...p, enabled } : p)));
    await fetch(`/api/sessions/${params.id}/plugins/${key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  }

  async function handleSaveSettings(key: string, settings: Record<string, unknown>) {
    setPlugins((prev) => prev.map((p) => (p.key === key ? { ...p, settings } : p)));
    await fetch(`/api/sessions/${params.id}/plugins/${key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
  }

  return (
    <div>
      <Link href="/dashboard" className="text-sm text-slate-400 hover:text-slate-200">
        &larr; Back to sessions
      </Link>

      <h1 className="mt-4 text-xl font-semibold">Plugins</h1>
      <p className="mt-1 text-sm text-slate-400">
        Configure how this WhatsApp session responds to messages.
      </p>

      <div className="mt-6 space-y-4">
        {loading ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : (
          plugins.map((plugin) => (
            <PluginCard
              key={plugin.key}
              name={plugin.name}
              description={plugin.description}
              enabled={plugin.enabled}
              onToggle={(enabled) => handleToggle(plugin.key, enabled)}
            >
              {plugin.key === 'autoreply' && (
                <AutoReplySettings
                  value={plugin.settings as AutoReplySettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
              {plugin.key === 'ai_reply' && (
                <AIReplySettings
                  sessionId={params.id}
                  value={plugin.settings as AIReplySettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
              {plugin.key === 'ai_write' && (
                <AIWriteSettings
                  value={plugin.settings as AIWriteSettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
              {plugin.key === 'song' && (
                <SongSettings
                  value={plugin.settings as SongSettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
              {plugin.key === 'anti_delete' && (
                <AntiDeleteSettings
                  value={plugin.settings as AntiDeleteSettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
            </PluginCard>
          ))
        )}
      </div>
    </div>
  );
}
