'use client';

import type { ReactNode } from 'react';

export type Exception = {
  phoneNumber: string;
  overrides: Record<string, unknown>;
};

// Shared list-editor for per-contact overrides -- both Auto Reply and AI
// Reply use this, each supplying its own override fields via renderOverrides
// (a custom message for one, a personality picker for the other) while the
// add/remove/exclude scaffolding stays identical.
export default function ExceptionsEditor({
  exceptions,
  onChange,
  defaultOverrides,
  renderOverrides,
}: {
  exceptions: Exception[];
  onChange: (exceptions: Exception[]) => void;
  defaultOverrides: Record<string, unknown>;
  renderOverrides: (
    overrides: Record<string, unknown>,
    setOverrides: (next: Record<string, unknown>) => void,
  ) => ReactNode;
}) {
  function addException() {
    onChange([...exceptions, { phoneNumber: '', overrides: { ...defaultOverrides } }]);
  }

  function updateException(index: number, patch: Partial<Exception>) {
    onChange(exceptions.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function removeException(index: number) {
    onChange(exceptions.filter((_, i) => i !== index));
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">
        Exceptions
        <span className="block text-xs font-normal text-slate-500">
          Give specific phone numbers their own settings, or exclude them entirely.
        </span>
      </label>

      <div className="space-y-3">
        {exceptions.map((exception, index) => {
          const excluded = exception.overrides.enabled === false;
          return (
            <div key={index} className="space-y-2 rounded-lg border border-surface-border p-3">
              <div className="flex items-center gap-2">
                <input
                  value={exception.phoneNumber}
                  onChange={(e) => updateException(index, { phoneNumber: e.target.value })}
                  placeholder="Phone number, e.g. 15551234567"
                  className="flex-1 rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs outline-none ring-violet-500/50 focus:ring-2"
                />
                <button
                  onClick={() => removeException(index)}
                  className="shrink-0 text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>

              <label className="flex items-center justify-between text-xs text-slate-400">
                <span>Exclude this contact entirely</span>
                <input
                  type="checkbox"
                  checked={excluded}
                  onChange={(e) =>
                    updateException(index, {
                      overrides: {
                        ...exception.overrides,
                        enabled: e.target.checked ? false : undefined,
                      },
                    })
                  }
                  className="h-3.5 w-3.5"
                />
              </label>

              {!excluded &&
                renderOverrides(exception.overrides, (next) =>
                  updateException(index, { overrides: next }),
                )}
            </div>
          );
        })}
      </div>

      <button
        onClick={addException}
        className="mt-2 text-xs font-medium text-violet-400 hover:text-violet-300"
      >
        + Add exception
      </button>
    </div>
  );
}
