import { z } from "zod";

export const productDiscountSchema = z.object({
  productId: z.string().min(1),
  discountPercent: z.number().min(0).max(100),
});

export const discountSettingsSchema = z.object({
  pixDiscountEnabled: z.boolean(),
  pixDiscountPercent: z.number().min(0).max(100),
  fixedDiscountEnabled: z.boolean(),
  fixedDiscountPercent: z.number().min(0).max(100),
  progressiveDiscountEnabled: z.boolean(),
  progressiveDiscount1Item: z.number().min(0).max(100),
  progressiveDiscount2Items: z.number().min(0).max(100),
  progressiveDiscount3PlusItems: z.number().min(0).max(100),
  progressiveDiscount4PlusItems: z.number().min(0).max(100),
  productDiscountsEnabled: z.boolean(),
  productDiscounts: z.array(productDiscountSchema),
});

export type DiscountSettingsInput = z.infer<typeof discountSettingsSchema>;
