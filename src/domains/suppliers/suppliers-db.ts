import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Supplier } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

export async function getSuppliers(): Promise<Supplier[]> {
  const snapshot = await adminDb.collection("suppliers").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp<Omit<Supplier, "id">>(doc.data()),
  }));
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const doc = await adminDb.collection("suppliers").doc(id).get();
  if (!doc.exists) return null;
  return {
    id: doc.id,
    ...convertTimestamp<Omit<Supplier, "id">>(doc.data()!),
  };
}

export async function createSupplier(
  data: Omit<Supplier, "id" | "createdAt" | "updatedAt">
): Promise<Supplier> {
  const now = new Date();
  const sanitizedData = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  ) as Omit<Supplier, "id" | "createdAt" | "updatedAt">;
  const docRef = await adminDb.collection("suppliers").add({
    ...sanitizedData,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  return { id: docRef.id, ...sanitizedData, createdAt: now, updatedAt: now };
}

export async function updateSupplier(
  id: string,
  data: Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  const sanitizedData = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  ) as Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt">>;
  await adminDb.collection("suppliers").doc(id).update({
    ...sanitizedData,
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function deleteSupplier(id: string): Promise<void> {
  await adminDb.collection("suppliers").doc(id).delete();
}
