import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  addMonthsISO,
  endOfStoreDay,
  formatStoreDate,
  formatStoreTime,
  monthsBetween,
  parseDateParam,
  startOfStoreDay,
  storeMonthRange,
  toCompetencyMonth,
  toStoreISODate,
} from "./dates";

describe("store-day boundaries (Brasília, UTC-3)", () => {
  it("starts a day at 03:00 UTC and ends it just before the next one", () => {
    expect(startOfStoreDay("2026-10-31")?.toISOString()).toBe("2026-10-31T03:00:00.000Z");
    expect(endOfStoreDay("2026-10-31")?.toISOString()).toBe("2026-11-01T02:59:59.999Z");
  });

  it("parses a date-only filter as the whole store day, so start = end is one full day", () => {
    const start = parseDateParam("2026-10-25", "start")!;
    const end = parseDateParam("2026-10-25", "end")!;
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("keeps a full ISO timestamp as given and ignores garbage", () => {
    expect(parseDateParam("2026-10-25T15:00:00.000Z", "start")?.toISOString()).toBe("2026-10-25T15:00:00.000Z");
    expect(parseDateParam("not a date", "start")).toBeUndefined();
    expect(parseDateParam(null, "end")).toBeUndefined();
  });
});

describe("calendar of an instant", () => {
  it("treats 22:30 in Brasília on the 31st as still the 31st and still that month", () => {
    const lateEvening = new Date("2026-11-01T01:30:00.000Z"); // 31/10 22:30 in Brasília
    expect(toStoreISODate(lateEvening)).toBe("2026-10-31");
    expect(toCompetencyMonth(lateEvening)).toBe("2026-10");
    expect(formatStoreDate(lateEvening)).toBe("31/10/2026");
    expect(formatStoreTime(lateEvening)).toBe("22:30");
  });
});

describe("month ranges", () => {
  it("covers a store month exactly", () => {
    const range = storeMonthRange("2026-12")!;
    expect(range.start.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2027-01-01T02:59:59.999Z");
  });

  it("lists every month a period touches", () => {
    expect(monthsBetween(startOfStoreDay("2026-09-26")!, endOfStoreDay("2026-10-25")!)).toEqual(["2026-09", "2026-10"]);
    expect(monthsBetween(startOfStoreDay("2026-12-15")!, endOfStoreDay("2027-01-05")!)).toEqual(["2026-12", "2027-01"]);
  });

  it("does month and day arithmetic across year ends", () => {
    expect(addMonthsISO("2026-11", 3)).toBe("2027-02");
    expect(addMonthsISO("2026-01", -1)).toBe("2025-12");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });
});
