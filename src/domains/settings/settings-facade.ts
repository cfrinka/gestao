import type { StoreSettings } from "@/lib/db-types";
import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import * as firestoreSettings from "@/domains/settings/settings-db";
import { applyStoreSettingsUpdate } from "@/domains/settings/in-memory-settings-store";

export async function getStoreSettings(): Promise<StoreSettings> {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) return dataset.settings;
  return firestoreSettings.getStoreSettings();
}

export async function updateStoreSettings(
  update: Partial<Omit<StoreSettings, "id" | "updatedAt">>
): Promise<StoreSettings> {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    dataset.settings = applyStoreSettingsUpdate(dataset.settings, update);
    return dataset.settings;
  }
  return firestoreSettings.updateStoreSettings(update);
}
