import { describe, expect, it } from "vitest";
import { parseOrderDateFilter } from "./order-date-filter";
import { InMemoryOrdersRepository } from "./in-memory-orders-repository";
import type { Order } from "@/lib/db-types";

describe("parseOrderDateFilter", () => {
  it("uses an ISO instant exactly as sent, regardless of the server's time zone", () => {
    // 00:00 de 15/11 em Brasília, como o navegador da loja manda.
    expect(parseOrderDateFilter("2026-11-15T03:00:00.000Z", "start")?.toISOString()).toBe("2026-11-15T03:00:00.000Z");
    expect(parseOrderDateFilter("2026-11-16T02:59:59.999Z", "end")?.toISOString()).toBe("2026-11-16T02:59:59.999Z");
    expect(parseOrderDateFilter("2026-11-15T00:00:00-03:00", "start")?.toISOString()).toBe("2026-11-15T03:00:00.000Z");
  });

  it("keeps the legacy server-local day boundaries for a bare yyyy-mm-dd", () => {
    const start = parseOrderDateFilter("2026-11-15", "start")!;
    const end = parseOrderDateFilter("2026-11-15", "end")!;
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2026, 10, 15, 0, 0]);
    expect([end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([15, 23, 59, 59, 999]);
  });

  it("snaps other parseable formats to the day boundary", () => {
    const start = parseOrderDateFilter("2026/11/15 14:30", "start")!;
    const end = parseOrderDateFilter("2026/11/15 14:30", "end")!;
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([15, 0, 0]);
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([15, 23, 59]);
  });

  it("returns undefined for missing or invalid values", () => {
    expect(parseOrderDateFilter(null, "start")).toBeUndefined();
    expect(parseOrderDateFilter("", "end")).toBeUndefined();
    expect(parseOrderDateFilter("ontem", "start")).toBeUndefined();
    expect(parseOrderDateFilter("2026-13-45T99:00:00Z", "start")).toBeUndefined();
  });
});

describe("InMemoryOrdersRepository.getOrders date range", () => {
  const order = (id: string, createdAt: string) => ({ id, createdAt: new Date(createdAt) }) as unknown as Order;
  const repo = new InMemoryOrdersRepository(
    new Map([
      ["a", order("a", "2026-11-14T23:30:00.000Z")],
      ["b", order("b", "2026-11-15T12:00:00.000Z")],
      ["c", order("c", "2026-11-16T01:00:00.000Z")],
    ]),
    new Map(),
    new Map()
  );
  const ids = (orders: Order[]) => orders.map((o) => o.id);

  it("applies both bounds", async () => {
    expect(ids(await repo.getOrders(new Date("2026-11-15T00:00:00Z"), new Date("2026-11-15T23:59:59Z")))).toEqual(["b"]);
  });

  it("applies a start bound on its own", async () => {
    expect(ids(await repo.getOrders(new Date("2026-11-15T00:00:00Z")))).toEqual(["c", "b"]);
  });

  it("applies an end bound on its own", async () => {
    expect(ids(await repo.getOrders(undefined, new Date("2026-11-15T23:59:59Z")))).toEqual(["b", "a"]);
  });

  it("returns everything, newest first, without bounds", async () => {
    expect(ids(await repo.getOrders())).toEqual(["c", "b", "a"]);
  });
});
