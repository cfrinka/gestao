import type { DiscountSettings, PaymentMethod } from "@/lib/db-types";

export interface DiscountableItem {
  productId: string;
  quantity: number;
  salePrice: number;
}

function progressivePercentForItemCount(settings: DiscountSettings, totalItems: number): number {
  if (totalItems >= 4) return settings.progressiveDiscount4PlusItems;
  if (totalItems === 3) return settings.progressiveDiscount3PlusItems;
  if (totalItems === 2) return settings.progressiveDiscount2Items;
  if (totalItems === 1) return settings.progressiveDiscount1Item;
  return 0;
}

/**
 * Recomputes the store's automatic/promotional discount (product-specific, fixed,
 * progressive, PIX) from trusted server-side inputs only. Never trust a client-supplied
 * promo discount value directly — it must always be derived from settings + cart contents.
 */
export function calculateAutoDiscount(
  items: DiscountableItem[],
  subtotal: number,
  settings: DiscountSettings,
  payments: PaymentMethod[]
): number {
  let autoDiscount = 0;

  if (settings.productDiscountsEnabled) {
    for (const item of items) {
      const productDiscount = settings.productDiscounts.find((pd) => pd.productId === item.productId);
      if (productDiscount && productDiscount.discountPercent > 0) {
        autoDiscount += (item.salePrice * item.quantity * productDiscount.discountPercent) / 100;
      }
    }
  }

  if (settings.fixedDiscountEnabled && settings.fixedDiscountPercent > 0) {
    autoDiscount += (subtotal * settings.fixedDiscountPercent) / 100;
  }

  if (settings.progressiveDiscountEnabled) {
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const progressivePercent = progressivePercentForItemCount(settings, totalItems);
    if (progressivePercent > 0) {
      autoDiscount += (subtotal * progressivePercent) / 100;
    }
  }

  if (settings.pixDiscountEnabled) {
    const pixPayment = payments.find((p) => p.method === "PIX");
    if (pixPayment && pixPayment.amount > 0) {
      autoDiscount += (pixPayment.amount * settings.pixDiscountPercent) / 100;
    }
  }

  return autoDiscount;
}
