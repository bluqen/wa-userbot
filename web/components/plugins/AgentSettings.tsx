'use client';

// No configurable fields beyond the enable toggle every plugin already
// gets from PluginCard -- this just surfaces usage info.
export type AgentSettingsValue = Record<string, never>;

const EXAMPLES = [
  '!ag tell mum, dad and roger I won’t be home soon',
  '!ag remind me in 2h to call the bank',
  '!ag ask roger if he’s free saturday',
  '!ag text mum in 30m that I’m on my way',
  '!ag remember that the wifi password is hunter2',
];

export default function AgentSettings() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Owner-only. Say what you want done in plain words and the agent works out the steps &mdash;
        who to message, what to send, what to schedule.
      </div>

      <div className="rounded-lg border border-surface-border bg-surface p-3">
        <p className="mb-2 text-xs font-medium text-slate-300">Try</p>
        <div className="space-y-1.5">
          {EXAMPLES.map((example) => (
            <code
              key={example}
              className="block rounded bg-surface-raised px-1.5 py-1 text-xs text-slate-300"
            >
              {example}
            </code>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/80">
        <p className="font-medium text-amber-200">It always asks first</p>
        <p className="mt-1">
          Anything that reaches another person is shown to you as a plan and only runs after you
          reply <code className="rounded bg-surface-raised px-1">!ag yes</code>. Things that only
          touch your own chat &mdash; reminders, notes, QR codes &mdash; just run.
        </p>
        <p className="mt-1.5">
          If a name doesn&apos;t match exactly one contact, nothing is sent and it tells you why.
        </p>
      </div>
    </div>
  );
}
