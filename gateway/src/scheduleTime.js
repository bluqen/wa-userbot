// Time parsing for "!sm <target> <when>".
//
// Everything here is timezone-aware on purpose. The gateway runs in UTC on
// Render, but "5pm" always means 5pm where the *owner* is -- scheduling a
// message an hour off is the same as the feature being broken, and it
// would look like a mystery rather than a bug. The session's timezone is a
// plugin setting; UTC is only the fallback.

const RELATIVE_RE = /^(?:\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|days?|d|seconds?|secs?|s)\s*)+$/i;
const RELATIVE_UNIT_RE = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|days?|d|seconds?|secs?|s)/gi;
// Requires either a colon or am/pm: a bare "6" is too ambiguous to act on,
// and letting it through would make "Study Group 2026" swallow its own
// year as a time.
const CLOCK_RE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const DAY_RE = /^(today|tonight|tomorrow|tmrw|tmr)\b\s*(.*)$/i;

const MIN_LEAD_MS = 5 * 1000;
const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
// How many trailing words to consider as the time. "tomorrow 6:30 pm" is
// the longest real form; anything more and we'd start eating target names.
const MAX_TIME_TOKENS = 3;

// Milliseconds to add to a UTC instant to get wall-clock time in `timeZone`.
// The formatToParts round-trip is the standard way to do this without a
// timezone library -- Intl knows the real offset including DST.
function zoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl can emit hour "24" for midnight under hour12:false.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Today's calendar date as seen in `timeZone` -- which can be a different
// day from UTC, the whole reason this isn't just date.getUTCDate().
function zonedToday(now, timeZone) {
  const shifted = new Date(now.getTime() + zoneOffsetMs(now, timeZone));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

// A wall-clock time in `timeZone` -> the UTC instant it refers to. Offsets
// are resolved at the target instant, then re-checked once, which settles
// the case where the guess and the answer fall on opposite sides of a DST
// change.
function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month, day, hour, minute);
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
  instant = guess - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * Parses the "when" part of a !sm command.
 * Understands "4h", "1h30m", "5pm", "6:30pm", "17:30", and any of those
 * prefixed with today/tonight/tomorrow.
 * Returns { runAt: Date, kind } or null if it isn't a time at all.
 */
export function parseScheduleTime(raw, { now = new Date(), timeZone = 'UTC' } = {}) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const text = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;

  let dayOffset = null; // null = the user didn't name a day
  let rest = text;
  const day = rest.match(DAY_RE);
  if (day) {
    dayOffset = /^(tomorrow|tmrw|tmr)$/i.test(day[1]) ? 1 : 0;
    rest = day[2].trim();
    if (!rest) return null; // "tomorrow" with no time of day
  }

  // Relative durations only make sense without a day word -- "tomorrow in
  // 4h" isn't a thing anyone means.
  if (dayOffset === null && RELATIVE_RE.test(rest)) {
    let totalMs = 0;
    RELATIVE_UNIT_RE.lastIndex = 0;
    let match;
    while ((match = RELATIVE_UNIT_RE.exec(rest))) {
      const value = Number(match[1]);
      const unit = match[2][0].toLowerCase();
      if (unit === 'd') totalMs += value * 86400000;
      else if (unit === 'h') totalMs += value * 3600000;
      else if (unit === 'm') totalMs += value * 60000;
      else totalMs += value * 1000;
    }
    if (totalMs < MIN_LEAD_MS || totalMs > MAX_LEAD_MS) return null;
    return { runAt: new Date(now.getTime() + totalMs), kind: 'relative' };
  }

  const clock = rest.match(CLOCK_RE);
  if (!clock) return null;
  const hasMinutes = clock[2] !== undefined;
  const meridiem = clock[3]?.toLowerCase();
  if (!hasMinutes && !meridiem) return null; // bare "6" -- too ambiguous

  let hour = Number(clock[1]);
  const minute = hasMinutes ? Number(clock[2]) : 0;
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }

  const today = zonedToday(now, zone);
  let runAt = zonedTimeToUtc(
    { year: today.year, month: today.month, day: today.day + (dayOffset ?? 0), hour, minute },
    zone,
  );

  // "5pm" typed at 6pm means tomorrow. Only applied when no day was named:
  // an explicit "today 5pm" that's already passed is a mistake worth
  // reporting rather than silently moving.
  if (dayOffset === null && runAt.getTime() <= now.getTime()) {
    runAt = zonedTimeToUtc(
      { year: today.year, month: today.month, day: today.day + 1, hour, minute },
      zone,
    );
  }

  if (runAt.getTime() - now.getTime() < MIN_LEAD_MS) return null;
  return { runAt, kind: 'clock' };
}

/**
 * Splits "Study Group 2026 6:30pm" into { target: "Study Group 2026",
 * timeText: "6:30pm", runAt }.
 *
 * The time is taken from the END, longest match first, because a target
 * can be several words and can itself contain digits -- so scanning from
 * the front would misread "2026" as part of the time. Trying the longest
 * trailing candidate first is what makes "tomorrow 9am" beat "9am".
 */
export function splitTargetAndTime(args, options = {}) {
  const tokens = String(args || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null; // need at least a target and a time

  const maxTake = Math.min(MAX_TIME_TOKENS, tokens.length - 1);
  for (let take = maxTake; take >= 1; take -= 1) {
    const timeText = tokens.slice(tokens.length - take).join(' ');
    const parsed = parseScheduleTime(timeText, options);
    if (parsed) {
      return {
        target: tokens.slice(0, tokens.length - take).join(' '),
        timeText,
        runAt: parsed.runAt,
        kind: parsed.kind,
      };
    }
  }
  return null;
}

// "in 4h" / "at 18:30 (Africa/Lagos)" -- for the confirmation message, so
// the owner can see it landed on the time they meant before walking away.
export function describeRunAt(runAt, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(runAt);
}
