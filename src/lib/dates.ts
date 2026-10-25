/**
 * Calendar math for the store, always in Brasília time — never the server's or UTC.
 *
 * `new Date("2026-10-31")` is midnight UTC, which is 21:00 on the 30th in Brasília, and
 * `toISOString()` on a local evening date gives tomorrow. Every "which day / which month" question
 * (report periods, day groups, competency months, due dates, a date input's default) goes
 * through here instead.
 */
export const STORE_TIME_ZONE = "America/Sao_Paulo";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface StoreDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function storeDateParts(date: Date): StoreDateParts {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Store-local wall-clock time → the instant it happens. */
export function storeTimeToDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // The offset is read at the guessed instant and once more at the corrected one, which settles
  // even across a daylight-saving change (Brazil has none today, but the zone database decides).
  let guess = wallAsUtc - offsetAt(new Date(wallAsUtc));
  guess = wallAsUtc - offsetAt(new Date(guess));
  return new Date(guess);
}

function offsetAt(date: Date): number {
  const p = storeDateParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-10-25" for the store's calendar day containing `date`. */
export function toStoreISODate(date: Date): string {
  const p = storeDateParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2026-10" for the store's calendar month containing `date` — the financial competency month. */
export function toCompetencyMonth(date: Date): string {
  const p = storeDateParts(date);
  return `${p.year}-${pad(p.month)}`;
}

export function todayISO(): string {
  return toStoreISODate(new Date());
}

export function currentMonthISO(): string {
  return toCompetencyMonth(new Date());
}

/** The store day `days` after (or before, if negative) the given "YYYY-MM-DD". */
export function addDaysISO(isoDate: string, days: number): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return isoDate;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const shifted = new Date(base + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 00:00 of a store day. */
export function startOfStoreDay(isoDate: string): Date | null {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return null;
  return storeTimeToDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** 23:59:59.999 of a store day. */
export function endOfStoreDay(isoDate: string): Date | null {
  const start = startOfStoreDay(addDaysISO(isoDate, 1));
  return start ? new Date(start.getTime() - 1) : null;
}

/** First instant and last instant of a store month "YYYY-MM". */
export function storeMonthRange(month: string): { start: Date; end: Date } | null {
  const match = ISO_MONTH.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const next = monthIndex === 12 ? { year: year + 1, month: 1 } : { year, month: monthIndex + 1 };
  const start = storeTimeToDate(year, monthIndex, 1);
  const end = new Date(storeTimeToDate(next.year, next.month, 1).getTime() - 1);
  return { start, end };
}

/** "YYYY-MM" plus n months. */
export function addMonthsISO(month: string, n: number): string {
  const match = ISO_MONTH.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + n;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Every competency month touched by [start, end], in order. */
export function monthsBetween(start: Date, end: Date): string[] {
  const months: string[] = [];
  const last = toCompetencyMonth(end);
  let cursor = toCompetencyMonth(start);
  while (cursor <= last && months.length < 240) {
    months.push(cursor);
    cursor = addMonthsISO(cursor, 1);
  }
  return months;
}

/**
 * A date filter from a query string: "YYYY-MM-DD" means that whole store day (its first instant
 * for a start bound, its last for an end bound); a full ISO timestamp is taken as given.
 */
export function parseDateParam(value: string | null | undefined, boundary: "start" | "end"): Date | undefined {
  if (!value) return undefined;
  if (ISO_DATE.test(value)) {
    return (boundary === "start" ? startOfStoreDay(value) : endOfStoreDay(value)) ?? undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** dd/mm/aaaa in store time. */
export function formatStoreDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { timeZone: STORE_TIME_ZONE });
}

/** HH:mm in store time. */
export function formatStoreTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { timeZone: STORE_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}
