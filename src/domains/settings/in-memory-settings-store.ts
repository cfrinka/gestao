import type { StoreSettings } from "@/lib/db-types";

export async function getStoreSettings(settings: StoreSettings): Promise<StoreSettings> {
  return settings;
}

export function applyStoreSettingsUpdate(
  settings: StoreSettings,
  update: Partial<Omit<StoreSettings, "id" | "updatedAt">>
): StoreSettings {
  return {
    ...settings,
    ...(update.storeName !== undefined ? { storeName: update.storeName } : {}),
    ...(update.address !== undefined ? { address: update.address } : {}),
    ...(update.phone !== undefined ? { phone: update.phone } : {}),
    ...(update.cnpj !== undefined ? { cnpj: update.cnpj } : {}),
    ...(update.footerMessage !== undefined ? { footerMessage: update.footerMessage } : {}),
    ...(update.exchangeDays !== undefined ? { exchangeDays: update.exchangeDays } : {}),
    ...(update.discounts !== undefined ? { discounts: update.discounts } : {}),
    updatedAt: new Date(),
  };
}
