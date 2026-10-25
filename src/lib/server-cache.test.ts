import { beforeEach, describe, expect, it, vi } from "vitest";
import { bumpDataVersion, cached, resetServerCache } from "./server-cache";

describe("server cache", () => {
  beforeEach(() => resetServerCache());

  it("answers repeated reads from memory", async () => {
    const load = vi.fn(async () => "products");
    await cached("products", load);
    await cached("products", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight load between concurrent readers", async () => {
    const load = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve("x"), 5)));
    await Promise.all([cached("k", load), cached("k", load), cached("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after any write bumps the data version", async () => {
    const load = vi.fn(async () => Math.random());
    const first = await cached("k", load);
    bumpDataVersion();
    const second = await cached("k", load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("reloads after the TTL", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 1);
    await cached("k", load, 1000);
    vi.advanceTimersByTime(1001);
    await cached("k", load, 1000);
    expect(load).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not keep a failed load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("firestore down")).mockResolvedValue("ok");
    await expect(cached("k", load)).rejects.toThrow("firestore down");
    await expect(cached("k", load)).resolves.toBe("ok");
  });
});
