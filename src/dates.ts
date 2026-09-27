// Strict ISO 8601 parsing for `verifiedAt`. Internal: not exported from index.ts.
//
// Why not `new Date(string)`: outside the exact ISO forms it falls back to an
// engine-specific parser that reads text like "July 4, 2026" or "1" as local
// time, rolls impossible days ("2026-02-30") forward into the next month, and
// reads an ISO timestamp with no offset as LOCAL time. The same registry then
// gives a different age on a laptop than in CI. This parser accepts a small,
// documented set of forms, always resolves them to an absolute instant, and
// treats everything else as unparseable.
//
// Accepted:  YYYY-MM-DD                          (UTC midnight)
//            YYYY-MM-DD[T or space]HH:mm[:ss[.f{1,9}]][Z | +HH[[:]mm] | -HH[[:]mm]]
// A timestamp with no offset is read as UTC, never as machine-local time.

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?)?$/;

const MS_PER_MINUTE = 60_000;

/** Result of a successful parse: the instant, and whether the input had no time component. */
export interface ParsedIsoInstant {
  /** Epoch milliseconds. */
  instant: number;
  /** True for a bare `YYYY-MM-DD` value; false for any timestamp, offset or not. */
  dateOnly: boolean;
}

/**
 * Parse an ISO 8601 date or timestamp, or `null` when the value is not a
 * string, not one of the accepted forms, or names a moment that does not
 * exist (Feb 30, hour 24, minute 60, ...).
 *
 * `dateOnly` distinguishes a bare calendar date from an explicit timestamp:
 * a bare date carries no time zone, so a caller may reasonably get a
 * future-date grace period a timestamp (an exact, zoned instant) should not
 * — see `checks.ts`'s future-tolerance handling.
 */
export function parseIsoInstant(value: unknown): ParsedIsoInstant | null {
  if (typeof value !== 'string') return null;
  const match = ISO.exec(value);
  if (match === null) return null;

  const dateOnly = match[4] === undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  // Keep milliseconds; extra fractional digits are truncated, not rounded.
  const millis = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0').slice(0, 3));

  if (hour > 23 || minute > 59 || second > 59) return null;

  // Date.UTC would map years 0-99 onto 1900-1999, so build the date with
  // setUTCFullYear, then confirm the calendar day survived (no roll-over).
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  date.setUTCHours(hour, minute, second, millis);

  let offsetMinutes = 0;
  if (match[9] !== undefined) {
    const offsetHours = Number(match[10]);
    const offsetMins = match[11] === undefined ? 0 : Number(match[11]);
    if (offsetHours > 23 || offsetMins > 59) return null;
    const sign = match[9] === '-' ? -1 : 1;
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  return { instant: date.getTime() - offsetMinutes * MS_PER_MINUTE, dateOnly };
}
