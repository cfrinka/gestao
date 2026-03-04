import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { DiscountSettings, StoreSettings } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

const DEFAULT_DISCOUNT_SETTINGS: DiscountSettings = {
  pixDiscountEnabled: false,
  pixDiscountPercent: 5,
  fixedDiscountEnabled: false,
  fixedDiscountPercent: 0,
  progressiveDiscountEnabled: false,
  progressiveDiscount1Item: 0,
  progressiveDiscount2Items: 0,
  progressiveDiscount3PlusItems: 0,
  productDiscountsEnabled: false,
  productDiscounts: [],
};

const DEFAULT_SETTINGS: Omit<StoreSettings, "id" | "updatedAt"> = {
  storeName: "Gestao Loja",
  address: "",
  phone: "",
  cnpj: "",
  footerMessage: "Obrigado pela preferencia!\nVolte sempre!",
  exchangeDays: 10,
  discounts: DEFAULT_DISCOUNT_SETTINGS,
};

export async function getStoreSettings(): Promise<StoreSettings> {
  const doc = await adminDb.collection("settings").doc("store").get();

  if (!doc.exists) {
    return {
      id: "store",
      ...DEFAULT_SETTINGS,
      updatedAt: new Date(),
    };
  }

  return {
    id: doc.id,
    ...DEFAULT_SETTINGS,
    ...convertTimestamp<Omit<StoreSettings, "id">>(doc.data()!),
  };
}

export async function updateStoreSettings(
  settings: Partial<Omit<StoreSettings, "id" | "updatedAt">>
): Promise<StoreSettings> {
  const now = new Date();
  await adminDb
    .collection("settings")
    .doc("store")
    .set(
      {
        ...settings,
        updatedAt: Timestamp.fromDate(now),
      },
      { merge: true }
    );

  return getStoreSettings();
}
