import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDayEnd, localDayStart, toLocalIsoDay } from "./local-date";

// Simula o navegador de uma loja em Brasília (UTC-3, sem horário de verão desde 2019).
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("local-date (fuso de Brasília)", () => {
  it("runs in the simulated time zone", () => {
    expect(new Date("2026-11-15T12:00:00Z").getTimezoneOffset()).toBe(180);
  });

  it("keeps 'today' as today after 21h, unlike toISOString", () => {
    const tenPmOn15th = new Date("2026-11-16T01:00:00.000Z"); // 22:00 de 15/11 em Brasília
    expect(tenPmOn15th.toISOString().split("T")[0]).toBe("2026-11-16"); // o bug antigo
    expect(toLocalIsoDay(tenPmOn15th)).toBe("2026-11-15");
  });

  it("turns a day into the store's 00:00–23:59.999 as UTC instants", () => {
    expect(localDayStart("2026-11-15")?.toISOString()).toBe("2026-11-15T03:00:00.000Z");
    expect(localDayEnd("2026-11-15")?.toISOString()).toBe("2026-11-16T02:59:59.999Z");
  });

  it("covers a sale made at 22:00 local time", () => {
    const sale = new Date("2026-11-16T01:00:00.000Z").getTime();
    expect(sale).toBeGreaterThanOrEqual(localDayStart("2026-11-15")!.getTime());
    expect(sale).toBeLessThanOrEqual(localDayEnd("2026-11-15")!.getTime());
  });

  it("rejects malformed days", () => {
    expect(localDayStart("15/11/2026")).toBeNull();
    expect(localDayEnd("")).toBeNull();
  });
});
