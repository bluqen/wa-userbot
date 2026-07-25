'use client';

import { useState, type ReactNode } from 'react';

export default function PluginCard({
  name,
  description,
  enabled,
  onToggle,
  children,
}: {
  name: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised">
      <div className="flex items-center justify-between gap-4 p-5">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <span
            className={`text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            &#9656;
          </span>
          <span>
            <span className="block font-medium">{name}</span>
            <span className="block text-sm text-slate-400">{description}</span>
          </span>
        </button>

        <label className="relative inline-flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="peer sr-only"
          />
          <div className="h-6 w-11 rounded-full bg-surface-border transition peer-checked:bg-emerald-600" />
          <div className="absolute left-1 h-4 w-4 rounded-full bg-slate-300 transition peer-checked:translate-x-5 peer-checked:bg-white" />
        </label>
      </div>

      {expanded && <div className="border-t border-surface-border p-5">{children}</div>}
    </div>
  );
}
