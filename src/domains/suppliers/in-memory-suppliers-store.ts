import { randomUUID } from "crypto";
import type { Supplier } from "@/lib/db-types";

export async function getSuppliers(suppliers: Map<string, Supplier>): Promise<Supplier[]> {
  return Array.from(suppliers.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSupplier(suppliers: Map<string, Supplier>, id: string): Promise<Supplier | null> {
  return suppliers.get(id) ?? null;
}

export async function createSupplier(
  suppliers: Map<string, Supplier>,
  data: Omit<Supplier, "id" | "createdAt" | "updatedAt">
): Promise<Supplier> {
  const now = new Date();
  const supplier: Supplier = { id: randomUUID(), ...data, createdAt: now, updatedAt: now };
  suppliers.set(supplier.id, supplier);
  return supplier;
}

export async function updateSupplier(
  suppliers: Map<string, Supplier>,
  id: string,
  data: Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  const existing = suppliers.get(id);
  if (!existing) return;
  suppliers.set(id, { ...existing, ...data, updatedAt: new Date() });
}

export async function deleteSupplier(suppliers: Map<string, Supplier>, id: string): Promise<void> {
  suppliers.delete(id);
}
