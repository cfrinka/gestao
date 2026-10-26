import type { DiscountSettings, PaymentMethod, ProductDiscount } from "@/lib/db-types";
import { roundMoney } from "@/lib/money";
import { todayISO } from "@/lib/dates";

export interface DiscountableItem {
  productId: string;
  quantity: number;
  salePrice: number;
}

/**
 * The product's discount on a store day, if one counts: product discounts switched on, a
 * percentage above zero, and the day within its dates (a clearance can end on its own).
 */
export function activeProductDiscount(
  settings: Pick<DiscountSettings, "productDiscountsEnabled" | "productDiscounts">,
  productId: string,
  today: string = todayISO()
): ProductDiscount | undefined {
  if (!settings.productDiscountsEnabled) return undefined;
  const discount = settings.productDiscounts.find((pd) => pd.productId === productId);
  if (!discount || !(discount.discountPercent > 0)) return undefined;
  if (discount.startsAt && today < discount.startsAt) return undefined;
  if (discount.endsAt && today > discount.endsAt) return undefined;
  return discount;
}

export function progressivePercentForItemCount(settings: DiscountSettings, totalItems: number): number {
  if (totalItems >= 4) return settings.progressiveDiscount4PlusItems;
  if (totalItems === 3) return settings.progressiveDiscount3PlusItems;
  if (totalItems === 2) return settings.progressiveDiscount2Items;
  if (totalItems === 1) return settings.progressiveDiscount1Item;
  return 0;
}

/**
 * The store's automatic discounts, split the way the POS shows them: everything that depends
 * on the cart (product, fixed, progressive) and the PIX discount, which depends on how much is
 * paid by PIX. Each part is rounded to cents on its own, and the POS imports this same function,
 * so the total on screen and the total saved can never differ by a fraction of a cent.
 */
export function calculateAutoDiscountBreakdown(
  items: DiscountableItem[],
  subtotal: number,
  settings: DiscountSettings,
  payments: PaymentMethod[],
  today: string = todayISO()
): { cart: number; pix: number } {
  let cartDiscount = 0;

  for (const item of items) {
    const productDiscount = activeProductDiscount(settings, item.productId, today);
    if (productDiscount) {
      cartDiscount += (item.salePrice * item.quantity * productDiscount.discountPercent) / 100;
    }
  }

  if (settings.fixedDiscountEnabled && settings.fixedDiscountPercent > 0) {
    cartDiscount += (subtotal * settings.fixedDiscountPercent) / 100;
  }

  if (settings.progressiveDiscountEnabled) {
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const progressivePercent = progressivePercentForItemCount(settings, totalItems);
    if (progressivePercent > 0) {
      cartDiscount += (subtotal * progressivePercent) / 100;
    }
  }

  let pixDiscount = 0;
  if (settings.pixDiscountEnabled) {
    const pixPayment = payments.find((p) => p.method === "PIX");
    if (pixPayment && pixPayment.amount > 0) {
      pixDiscount = (pixPayment.amount * settings.pixDiscountPercent) / 100;
    }
  }

  return { cart: roundMoney(cartDiscount), pix: roundMoney(pixDiscount) };
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
  payments: PaymentMethod[],
  today: string = todayISO()
): number {
  const { cart, pix } = calculateAutoDiscountBreakdown(items, subtotal, settings, payments, today);
  return roundMoney(cart + pix);
}
