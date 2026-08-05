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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-2xl border border-surface-border bg-surface-raised shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden border-b border-surface-border bg-gradient-to-br from-violet-600/15 via-transparent to-transparent p-5 sm:p-6">
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-surface hover:text-slate-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              <div className="flex items-center gap-3.5 pr-8">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-600/20 text-3xl">
                  {icon}
                </span>
                <div>
                  <h2 className="text-lg font-semibold">{name}</h2>
                  <p className="mt-0.5 text-sm text-slate-400">{description}</p>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(85vh-6.5rem)] overflow-y-auto p-5 sm:p-6">
              <label className="mb-5 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-surface-border bg-surface px-4 py-3">
                <span className="text-sm font-medium">
                  {enabled ? "On -- it's active right now" : 'Off -- turn it on to start using it'}
                </span>
                <span className="relative inline-flex shrink-0 items-center">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => onToggle(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="h-6 w-11 rounded-full bg-surface-border transition peer-checked:bg-violet-600" />
                  <span className="absolute left-1 h-4 w-4 rounded-full bg-slate-300 transition peer-checked:translate-x-5 peer-checked:bg-white" />
                </span>
              </label>

              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
