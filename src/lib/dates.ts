// Calendar dates without a time ("YYYY-MM-DD"), used for delivery days. A
// delivery day is a day on the supplier's calendar, so "today" is computed in
// the supplier's timezone (CLAUDE.md: never hardcode Tbilisi).

export const MAX_DELIVERY_DAYS_AHEAD = 90;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns the date if it is a real calendar day in "YYYY-MM-DD" form, else null. */
export function parseDateInput(input: string): string | null {
  const m = DATE_RE.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Today's calendar date in an IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today or later, and no more than MAX_DELIVERY_DAYS_AHEAD days out. */
export function isDeliveryDateAllowed(date: string, today: string): boolean {
  return date >= today && date <= addDays(today, MAX_DELIVERY_DAYS_AHEAD);
}

/** ISO weekday (Monday = 1 ... Sunday = 7) of an instant in an IANA timezone. */
export function isoWeekdayIn(timeZone: string, now: Date = new Date()): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[name] ?? 1;
}

/** Hour of day (0-23) of an instant in an IANA timezone. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(hour) % 24;
}
