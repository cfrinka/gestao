import type { Supplier } from "@/lib/db-types";
import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import * as firestoreSuppliers from "@/domains/suppliers/suppliers-db";
import * as inMemorySuppliers from "@/domains/suppliers/in-memory-suppliers-store";

function demoSuppliersMap(): Map<string, Supplier> | null {
  const sessionId = getDemoSessionId();
  if (!sessionId) return null;
  const dataset = getDemoDataset(sessionId);
  return dataset ? dataset.suppliers : null;
}

export async function getSuppliers(): Promise<Supplier[]> {
  const demo = demoSuppliersMap();
  if (demo) return inMemorySuppliers.getSuppliers(demo);
  return firestoreSuppliers.getSuppliers();
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const demo = demoSuppliersMap();
  if (demo) return inMemorySuppliers.getSupplier(demo, id);
  return firestoreSuppliers.getSupplier(id);
}

export async function createSupplier(
  data: Omit<Supplier, "id" | "createdAt" | "updatedAt">
): Promise<Supplier> {
  const demo = demoSuppliersMap();
  if (demo) return inMemorySuppliers.createSupplier(demo, data);
  return firestoreSuppliers.createSupplier(data);
}

export async function updateSupplier(
  id: string,
  data: Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  const demo = demoSuppliersMap();
  if (demo) return inMemorySuppliers.updateSupplier(demo, id, data);
  return firestoreSuppliers.updateSupplier(id, data);
}

export async function deleteSupplier(id: string): Promise<void> {
  const demo = demoSuppliersMap();
  if (demo) return inMemorySuppliers.deleteSupplier(demo, id);
  return firestoreSuppliers.deleteSupplier(id);
}
