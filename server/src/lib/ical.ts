// Minimal, dependency-free iCalendar (RFC 5545) builder for the calendar feed (T4.2). Emits all-day
// VEVENTs (VALUE=DATE) — right for project milestones/task windows. Enough for Google/Outlook/Apple
// to subscribe to a feed URL; not a full iCal implementation.

export interface IcalEvent {
  uid: string;
  summary: string;
  start: Date;      // inclusive all-day start
  end: Date;        // inclusive last day (converted to the exclusive DTEND below)
  description?: string;
}

// RFC5545 TEXT escaping: backslash, semicolon, comma, and newlines.
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// YYYYMMDD in UTC for VALUE=DATE.
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function plusDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function buildIcs(events: IcalEvent[], calName = 'Prismatix'): string {
  const stamp = `${ymd(new Date())}T000000Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prismatix//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.start)}`,
      // DTEND is exclusive for all-day events → last day + 1.
      `DTEND;VALUE=DATE:${ymd(plusDays(e.end, 1))}`,
      `SUMMARY:${esc(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  // RFC5545 wants CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}
