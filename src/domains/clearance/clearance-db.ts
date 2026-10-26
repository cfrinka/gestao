import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { HttpError } from "@/lib/api/http-errors";
import { roundMoney } from "@/lib/money";
import { addDaysISO, startOfStoreDay, todayISO } from "@/lib/dates";
import { cached } from "@/lib/server-cache";
import type { DiscountSettings, ProductDiscount } from "@/lib/db-types";
import { getProductsCached } from "@/domains/products/products-db";
import { getStoreSettingsCached } from "@/domains/settings/settings-db";
import { loadSoldLines } from "@/domains/reports/operational-reports";
import { computeClearanceCandidates, describeClearances, percentForPrice } from "@/domains/clearance/clearance";

/** How far back the screen looks for each product's last sale. */
const LOOKBACK_DAYS = 365;
const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function getClearanceOverview(windowDays: number) {
  const days = [30, 60, 90].includes(windowDays) ? windowDays : 30;
  return cached(`clearance:${days}`, async () => {
    const now = new Date();
    const today = todayISO();
    const start = startOfStoreDay(addDaysISO(today, -LOOKBACK_DAYS))!;
    const [lines, products, settings] = await Promise.all([loadSoldLines(start, now), getProductsCached(), getStoreSettingsCached()]);

    const lastSaleByProduct = new Map<string, Date>();
    for (const line of lines) {
      const previous = lastSaleByProduct.get(line.productId);
      if (!previous || line.at > previous) lastSaleByProduct.set(line.productId, line.at);
    }

    const discounts = settings.discounts;
    return {
      windowDays: days,
      today,
      productDiscountsEnabled: discounts.productDiscountsEnabled,
      ...computeClearanceCandidates(products, lastSaleByProduct, {
        now,
        today,
        windowDays: days,
        lookbackDays: LOOKBACK_DAYS,
        discounts,
      }),
      inProgress: describeClearances(discounts.productDiscounts ?? [], products, lines, today, startOfStoreDay),
    };
  });
}

export interface ClearanceItemInput {
  productId: string;
  /** The final price the owner chose for the product. */
  price: number;
}

/**
 * Puts the chosen products on clearance at the chosen prices, from today until `endsAt` (or with
 * no end). Each becomes a product discount, replacing any discount the product had; product
 * discounts are switched on. One transaction, so a concurrent settings save can't half-apply it.
 */
export async function applyClearance(input: { items: ClearanceItemInput[]; endsAt?: string | null }): Promise<number> {
  const today = todayISO();
  const endsAt = input.endsAt ? String(input.endsAt) : null;
  if (endsAt && (!ISO_DAY.test(endsAt) || endsAt < today)) {
    throw new HttpError(400, "A data final precisa ser hoje ou depois.");
  }

  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) throw new HttpError(400, "Escolha ao menos um produto.");
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.productId !== "string" || !item.productId) throw new HttpError(400, "Produto inválido.");
    if (seen.has(item.productId)) throw new HttpError(400, "Um produto foi enviado duas vezes.");
    seen.add(item.productId);
  }

  const settingsRef = adminDb.collection("settings").doc("store");
  const productRefs = items.map((item) => adminDb.collection("products").doc(item.productId));

  return adminDb.runTransaction(async (tx) => {
    const [settingsSnap, ...productSnaps] = await Promise.all([tx.get(settingsRef), ...productRefs.map((ref) => tx.get(ref))]);

    const next: ProductDiscount[] = [];
    items.forEach((item, index) => {
      const snap = productSnaps[index];
      if (!snap.exists) throw new HttpError(404, "Um dos produtos não existe mais. Atualize a tela.");
      const product = snap.data() as { name?: string; salePrice?: number };
      const salePrice = roundMoney(Number(product.salePrice || 0));
      const price = roundMoney(Number(item.price));
      if (!Number.isFinite(price) || price <= 0 || price >= salePrice) {
        throw new HttpError(400, `O preço de liquidação de ${product.name || "um produto"} precisa ficar entre R$ 0,01 e o preço atual.`);
      }
      next.push({
        productId: item.productId,
        discountPercent: percentForPrice(salePrice, price),
        startsAt: today,
        ...(endsAt ? { endsAt } : {}),
        source: "clearance",
      });
    });

    const discounts = (settingsSnap.data()?.discounts ?? {}) as Partial<DiscountSettings>;
    const kept = (discounts.productDiscounts ?? []).filter((pd) => !seen.has(pd.productId));
    tx.set(
      settingsRef,
      {
        discounts: { ...discounts, productDiscountsEnabled: true, productDiscounts: [...kept, ...next] },
        updatedAt: Timestamp.fromDate(new Date()),
      },
      { merge: true }
    );
    return next.length;
  });
}

/** Takes the products off clearance (their product discount is removed). */
export async function endClearance(productIds: string[]): Promise<number> {
  const ids = new Set((Array.isArray(productIds) ? productIds : []).filter((id) => typeof id === "string" && id));
  if (ids.size === 0) throw new HttpError(400, "Escolha ao menos um produto.");
  const settingsRef = adminDb.collection("settings").doc("store");

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(settingsRef);
    const discounts = (snap.data()?.discounts ?? {}) as Partial<DiscountSettings>;
    const current = discounts.productDiscounts ?? [];
    const kept = current.filter((pd) => !ids.has(pd.productId));
    tx.set(
      settingsRef,
      { discounts: { ...discounts, productDiscounts: kept }, updatedAt: Timestamp.fromDate(new Date()) },
      { merge: true }
    );
    return current.length - kept.length;
  });
}
