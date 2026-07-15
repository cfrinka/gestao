import { describe, expect, it } from "vitest";
import { discountSettingsSchema } from "./discount-settings-schema";

const validSettings = {
  pixDiscountEnabled: true,
  pixDiscountPercent: 5,
  fixedDiscountEnabled: false,
  fixedDiscountPercent: 0,
  progressiveDiscountEnabled: true,
  progressiveDiscount1Item: 10,
  progressiveDiscount2Items: 30,
  progressiveDiscount3PlusItems: 40,
  progressiveDiscount4PlusItems: 60,
  productDiscountsEnabled: true,
  productDiscounts: [{ productId: "p1", discountPercent: 20 }],
};

describe("discountSettingsSchema", () => {
  it("accepts valid settings", () => {
    expect(discountSettingsSchema.safeParse(validSettings).success).toBe(true);
  });

  it("rejects a discount percent above 100", () => {
    const result = discountSettingsSchema.safeParse({ ...validSettings, progressiveDiscount4PlusItems: 500 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative discount percent", () => {
    const result = discountSettingsSchema.safeParse({ ...validSettings, fixedDiscountPercent: -10 });
    expect(result.success).toBe(false);
  });

  it("rejects a product discount above 100", () => {
    const result = discountSettingsSchema.safeParse({
      ...validSettings,
      productDiscounts: [{ productId: "p1", discountPercent: 150 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts the boundary values 0 and 100", () => {
    expect(discountSettingsSchema.safeParse({ ...validSettings, pixDiscountPercent: 0 }).success).toBe(true);
    expect(discountSettingsSchema.safeParse({ ...validSettings, pixDiscountPercent: 100 }).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { pixDiscountEnabled: _omit, ...incomplete } = validSettings;
    expect(discountSettingsSchema.safeParse(incomplete).success).toBe(false);
  });
});
