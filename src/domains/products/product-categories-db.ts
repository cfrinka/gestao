import { adminDb } from "@/lib/firebase-admin";

// The ordered category list lives in Firestore (settings/productCategories) so it can
// change without a code deploy — no page or route should keep its own copy of it.
function categoriesRef() {
  return adminDb.collection("settings").doc("productCategories");
}

export async function getProductCategories(): Promise<string[]> {
  const doc = await categoriesRef().get();
  const stored = doc.data()?.categories;
  if (Array.isArray(stored)) {
    return stored.filter((category): category is string => typeof category === "string" && category.trim() !== "");
  }

  // No list saved yet: fall back to the categories products already use.
  const snapshot = await adminDb.collection("products").select("category").get();
  const inUse = new Set<string>();
  for (const productDoc of snapshot.docs) {
    const category = productDoc.get("category");
    if (typeof category === "string" && category.trim()) inUse.add(category);
  }
  return Array.from(inUse).sort((a, b) => a.localeCompare(b, "pt-BR"));
}
