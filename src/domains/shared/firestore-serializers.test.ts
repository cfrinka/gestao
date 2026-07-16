import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { convertTimestamp } from "./firestore-serializers";

describe("convertTimestamp", () => {
  it("converts Firestore Timestamp fields to Date instances", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = convertTimestamp<{ createdAt: Date; name: string }>({
      name: "test",
      createdAt: Timestamp.fromDate(now),
    });
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toBe(now.toISOString());
    expect(result.name).toBe("test");
  });

  it("leaves non-Timestamp fields untouched", () => {
    const result = convertTimestamp<{ count: number; active: boolean; nested: { a: number } }>({
      count: 5,
      active: true,
      nested: { a: 1 },
    });
    expect(result).toEqual({ count: 5, active: true, nested: { a: 1 } });
  });

  it("does not mutate the original object", () => {
    const original = { createdAt: Timestamp.fromDate(new Date()) };
    const result = convertTimestamp<{ createdAt: Date }>(original);
    expect(result).not.toBe(original);
  });
});
