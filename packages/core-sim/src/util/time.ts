/**
 * Strict, platform-independent ISO-8601 parsing.
 *
 * `Date.parse` treats zone-less date-times as *local* time (host-dependent), so it is not used.
 * Civil dates are converted with integer arithmetic (H. Hinnant's days-from-civil), giving the
 * same result on every host. Zone-less inputs are interpreted as UTC (the contracts say every
 * date is ISO-8601 UTC).
 */

const ISO_RE =
  /^([+-]?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

export const MS_PER_DAY = 86_400_000;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Days since 1970-01-01 for a proleptic Gregorian civil date (m 1..12). */
function daysFromCivil(year: number, m: number, d: number): number {
  const y = m <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Milliseconds since the Unix epoch for an ISO-8601 string, or `NaN` when the string is not a
 * valid ISO-8601 date / date-time. Accepted: `YYYY-MM-DD`, optional `THH:MM[:SS[.fffffffff]]`,
 * optional `Z` or `±HH[:MM]` offset. Zone-less → UTC.
 */
export function parseIsoUtcMs(iso: string): number {
  if (typeof iso !== "string") return Number.NaN;
  const m = ISO_RE.exec(iso.trim());
  if (!m) return Number.NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12) return Number.NaN;
  if (day < 1 || day > daysInMonth(year, month)) return Number.NaN;
  if (hour > 23 || minute > 59 || second > 60) return Number.NaN;
  const fracMs = m[7] === undefined ? 0 : Number(`0.${m[7]}`) * 1000;
  let offsetMin = 0;
  const zone = m[8];
  if (zone !== undefined && zone.toUpperCase() !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (oh > 23 || om > 59) return Number.NaN;
    offsetMin = sign * (oh * 60 + om);
  }
  const days = daysFromCivil(year, month, day);
  return days * MS_PER_DAY + hour * 3_600_000 + minute * 60_000 + second * 1000 + fracMs - offsetMin * 60_000;
}

/**
 * Signed number of days from `isoA` to `isoB` (`B − A`, fractional). `NaN` if either string is
 * not valid ISO-8601. Use `Math.abs` for a separation.
 */
export function daysBetween(isoA: string, isoB: string): number {
  const a = parseIsoUtcMs(isoA);
  const b = parseIsoUtcMs(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return (b - a) / MS_PER_DAY;
}
