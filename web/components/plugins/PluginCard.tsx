'use client';

import { useState, type ReactNode } from 'react';

export default function PluginCard({
  icon,
  name,
  description,
  enabled,
  onToggle,
  children,
}: {
  icon: string;
  name: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={`group relative flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition sm:p-5 ${
          enabled
            ? 'border-violet-700/50 bg-violet-950/10 hover:bg-violet-950/20'
            : 'border-surface-border bg-surface-raised hover:bg-surface'
        }`}
      >
        <label
          className="absolute right-3 top-3 inline-flex shrink-0 cursor-pointer items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="peer sr-only"
          />
          <div className="h-5 w-9 rounded-full bg-surface-border transition peer-checked:bg-violet-600" />
          <div className="absolute left-0.5 h-4 w-4 rounded-full bg-slate-300 transition peer-checked:translate-x-4 peer-checked:bg-white" />
        </label>

        <button
          onClick={() => setOpen(true)}
          className="flex w-full flex-col items-center gap-2 pt-2"
        >
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-2xl text-3xl transition group-hover:scale-105 sm:h-16 sm:w-16 ${
              enabled ? 'bg-violet-600/20' : 'bg-surface'
            }`}
          >
            {icon}
          </span>
          <span className="text-sm font-medium sm:text-base">{name}</span>
          <span className="line-clamp-2 text-xs text-slate-400">{description}</span>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-surface-border bg-surface-raised p-5 shadow-xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-xl">
                  {icon}
                </span>
                <div>
                  <h2 className="font-semibold">{name}</h2>
                  <p className="text-xs text-slate-400">{description}</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="shrink-0 text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
