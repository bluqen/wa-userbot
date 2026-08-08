'use client';

import { useState } from 'react';
import { useSaveState } from '@/lib/useSaveState';
import SaveButton from '@/components/SaveButton';

export type ScheduledSendSettingsValue = {
  timezone: string;
};

// A short list rather than the full IANA database: this only has to cover
// "where is the owner", and a searchable 400-entry dropdown would be worse
// for that than a dozen sensible options. Any valid IANA name still works
// if it's set another way -- the gateway validates against Intl, not this
// list.
const ZONES = [
  'UTC',
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export default function ScheduledSendSettings({
  value,
  onSave,
}: {
  value: ScheduledSendSettingsValue;
  onSave: (value: ScheduledSendSettingsValue) => Promise<void>;
}) {
  const [form, setForm] = useState<ScheduledSendSettingsValue>({
    timezone: value?.timezone || 'UTC',
  });
  const { saving, saved, save } = useSaveState(onSave);

  const now = new Date();
  let preview = '';
  try {
    preview = new Intl.DateTimeFormat('en-GB', {
      timeZone: form.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);
  } catch {
    preview = '--:--';
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-400">
        Owner-only. Reply to any message &mdash; text, a photo with its caption, a document, a
        voice note &mdash; with{' '}
        <code className="rounded bg-surface-raised px-1">!sm &lt;who&gt; &lt;when&gt;</code> and it
        gets sent for you later.
        <div className="mt-2 space-y-1">
          <code className="block rounded bg-surface-raised px-1.5 py-1">!sm +2349393048203 5pm</code>
          <code className="block rounded bg-surface-raised px-1.5 py-1">!sm mum 4h</code>
          <code className="block rounded bg-surface-raised px-1.5 py-1">!sm Study Group 2026 6:30pm</code>
          <code className="block rounded bg-surface-raised px-1.5 py-1">!sm dad tomorrow 9am</code>
        </div>
        <p className="mt-2">
          Who can be a phone number, a saved contact, or a group you&apos;re in.{' '}
          <code className="rounded bg-surface-raised px-1">!schedule</code> works too.
        </p>
        <p className="mt-2">
          <code className="rounded bg-surface-raised px-1">!sm list</code> shows what&apos;s
          pending, numbered &mdash; cancel one with{' '}
          <code className="rounded bg-surface-raised px-1">!sm cancel &lt;number&gt;</code>.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Your timezone</label>
        <select
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-slate-200"
        >
          {ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-slate-500">
          So &quot;5pm&quot; means 5pm where you are. It&apos;s currently{' '}
          <span className="text-slate-300">{preview}</span> there. Only affects clock times &mdash;
          &quot;4h&quot; is 4 hours from now regardless.
        </p>
      </div>

      <SaveButton saving={saving} saved={saved} onClick={() => save(form)} />
    </div>
  );
}
