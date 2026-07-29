'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PluginCard from '@/components/plugins/PluginCard';
import LoadingDots from '@/components/LoadingDots';
import AutoReplySettings, {
  type AutoReplySettingsValue,
} from '@/components/plugins/AutoReplySettings';
import AIReplySettings, { type AIReplySettingsValue } from '@/components/plugins/AIReplySettings';
import AIWriteSettings, { type AIWriteSettingsValue } from '@/components/plugins/AIWriteSettings';
import SongSettings, { type SongSettingsValue } from '@/components/plugins/SongSettings';
import AntiDeleteSettings, {
  type AntiDeleteSettingsValue,
} from '@/components/plugins/AntiDeleteSettings';
import NotesSettings from '@/components/plugins/NotesSettings';
import WelcomeSettings, {
  type WelcomeSettingsValue,
} from '@/components/plugins/WelcomeSettings';
import AntiLinkSettings, {
  type AntiLinkSettingsValue,
} from '@/components/plugins/AntiLinkSettings';
import GamesSettings, { type GamesSettingsValue } from '@/components/plugins/GamesSettings';
import BroadcastsManager from '@/components/plugins/BroadcastsManager';

type PluginConfig = {
  key: string;
  name: string;
  description: string;
  icon: string;
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
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-sm text-slate-300 transition hover:bg-surface hover:text-slate-100"
      >
        &larr; Back to sessions
      </Link>

      <h1 className="mt-4 text-xl font-semibold">Plugins</h1>
      <p className="mt-1 text-sm text-slate-400">
        Configure how this WhatsApp session responds to messages. Tap a tile to open its
        settings.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {loading ? (
          <LoadingDots label="Loading plugins" />
        ) : (
          plugins.map((plugin) => (
            <PluginCard
              key={plugin.key}
              icon={plugin.icon}
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
              {plugin.key === 'notes' && <NotesSettings sessionId={params.id} />}
              {plugin.key === 'welcome' && (
                <WelcomeSettings
                  value={plugin.settings as WelcomeSettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
              {plugin.key === 'antilink' && (
                <AntiLinkSettings
                  value={plugin.settings as AntiLinkSettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
              {plugin.key === 'games' && (
                <GamesSettings
                  value={plugin.settings as GamesSettingsValue}
                  onSave={(settings) => handleSaveSettings(plugin.key, settings)}
                />
              )}
              {plugin.key === 'broadcast' && <BroadcastsManager sessionId={params.id} />}
            </PluginCard>
          ))
        )}
      </div>
    </div>
  );
}
