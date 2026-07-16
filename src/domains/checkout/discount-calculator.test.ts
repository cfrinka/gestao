import { describe, expect, it } from "vitest";
import { calculateAutoDiscount } from "./discount-calculator";
import type { DiscountSettings, PaymentMethod } from "@/lib/db-types";

const baseSettings: DiscountSettings = {
  pixDiscountEnabled: false,
  pixDiscountPercent: 5,
  fixedDiscountEnabled: false,
  fixedDiscountPercent: 0,
  progressiveDiscountEnabled: false,
  progressiveDiscount1Item: 0,
  progressiveDiscount2Items: 0,
  progressiveDiscount3PlusItems: 0,
  progressiveDiscount4PlusItems: 0,
  productDiscountsEnabled: false,
  productDiscounts: [],
};

describe("calculateAutoDiscount", () => {
  it("returns 0 when nothing is enabled", () => {
    expect(calculateAutoDiscount([{ productId: "p1", quantity: 2, salePrice: 50 }], 100, baseSettings, [])).toBe(0);
  });

  it("applies the correct progressive tier by total item count", () => {
    const settings: DiscountSettings = {
      ...baseSettings,
      progressiveDiscountEnabled: true,
      progressiveDiscount1Item: 10,
      progressiveDiscount2Items: 30,
      progressiveDiscount3PlusItems: 40,
      progressiveDiscount4PlusItems: 60,
    };

    expect(calculateAutoDiscount([{ productId: "p1", quantity: 1, salePrice: 45 }], 45, settings, [])).toBeCloseTo(4.5);
    expect(calculateAutoDiscount([{ productId: "p1", quantity: 2, salePrice: 62.495 }], 124.99, settings, [])).toBeCloseTo(37.497);
    expect(calculateAutoDiscount([{ productId: "p1", quantity: 3, salePrice: 40 }], 120, settings, [])).toBeCloseTo(48);
    expect(calculateAutoDiscount([{ productId: "p1", quantity: 6, salePrice: 49.998333 }], 299.99, settings, [])).toBeCloseTo(179.994);
  });

  it("applies no progressive discount when there are zero items", () => {
    const settings: DiscountSettings = {
      ...baseSettings,
      progressiveDiscountEnabled: true,
      progressiveDiscount1Item: 10,
      progressiveDiscount2Items: 30,
      progressiveDiscount3PlusItems: 40,
      progressiveDiscount4PlusItems: 60,
    };
    expect(calculateAutoDiscount([], 0, settings, [])).toBe(0);
  });

  it("never applies a discount for a tier with a 0% configured rate", () => {
    const settings: DiscountSettings = { ...baseSettings, progressiveDiscountEnabled: true, progressiveDiscount2Items: 0 };
    expect(calculateAutoDiscount(
      [{ productId: "p1", quantity: 1, salePrice: 10 }, { productId: "p2", quantity: 1, salePrice: 10 }],
      20,
      settings,
      []
    )).toBe(0);
  });

  it("applies a per-product discount only to matching products", () => {
    const settings: DiscountSettings = {
      ...baseSettings,
      productDiscountsEnabled: true,
      productDiscounts: [{ productId: "p1", discountPercent: 20 }],
    };
    const items = [
      { productId: "p1", quantity: 2, salePrice: 50 }, // 20% of 100 = 20
      { productId: "p2", quantity: 1, salePrice: 30 }, // no matching discount
    ];
    expect(calculateAutoDiscount(items, 130, settings, [])).toBeCloseTo(20);
  });

  it("applies the fixed discount as a percentage of subtotal", () => {
    const settings: DiscountSettings = { ...baseSettings, fixedDiscountEnabled: true, fixedDiscountPercent: 25 };
    expect(calculateAutoDiscount([{ productId: "p1", quantity: 1, salePrice: 100 }], 100, settings, [])).toBeCloseTo(25);
  });

  it("applies PIX discount only to the PIX payment amount, not the whole subtotal", () => {
    const settings: DiscountSettings = { ...baseSettings, pixDiscountEnabled: true, pixDiscountPercent: 5 };
    const payments: PaymentMethod[] = [
      { method: "PIX", amount: 40 },
      { method: "DINHEIRO", amount: 60 },
    ];
    expect(calculateAutoDiscount([{ productId: "p1", quantity: 1, salePrice: 100 }], 100, settings, payments)).toBeCloseTo(2);
  });

  it("ignores PIX discount when there is no PIX payment", () => {
    const settings: DiscountSettings = { ...baseSettings, pixDiscountEnabled: true, pixDiscountPercent: 5 };
    const payments: PaymentMethod[] = [{ method: "DINHEIRO", amount: 100 }];
    expect(calculateAutoDiscount([{ productId: "p1", quantity: 1, salePrice: 100 }], 100, settings, payments)).toBe(0);
  });

  it("stacks product, fixed, progressive, and PIX discounts together", () => {
    const settings: DiscountSettings = {
      pixDiscountEnabled: true,
      pixDiscountPercent: 10,
      fixedDiscountEnabled: true,
      fixedDiscountPercent: 5,
      progressiveDiscountEnabled: true,
      progressiveDiscount1Item: 0,
      progressiveDiscount2Items: 15,
      progressiveDiscount3PlusItems: 0,
      progressiveDiscount4PlusItems: 0,
      productDiscountsEnabled: true,
      productDiscounts: [{ productId: "p1", discountPercent: 10 }],
    };
    const items = [
      { productId: "p1", quantity: 1, salePrice: 100 },
      { productId: "p2", quantity: 1, salePrice: 100 },
    ];
    const payments: PaymentMethod[] = [{ method: "PIX", amount: 200 }];

    // product: 10% of p1's 100 = 10
    // fixed: 5% of 200 = 10
    // progressive (2 items): 15% of 200 = 30
    // pix: 10% of 200 = 20
    expect(calculateAutoDiscount(items, 200, settings, payments)).toBeCloseTo(70);
  });
});
