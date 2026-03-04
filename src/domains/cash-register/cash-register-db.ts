import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { CashRegister, Order, PaymentMethod } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

export async function getOpenCashRegister(userId: string): Promise<CashRegister | null> {
  const snapshot = await adminDb
    .collection("cashRegisters")
    .where("userId", "==", userId)
    .where("status", "==", "OPEN")
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...convertTimestamp<Omit<CashRegister, "id">>(doc.data()) };
}

export async function openCashRegister(
  userId: string,
  userName: string,
  openingBalance: number
): Promise<CashRegister> {
  const now = new Date();
  const docRef = await adminDb.collection("cashRegisters").add({
    userId,
    userName,
    openedAt: Timestamp.fromDate(now),
    closedAt: null,
    openingBalance,
    closingBalance: null,
    status: "OPEN",
    totalSales: 0,
    totalCash: 0,
    totalDebit: 0,
    totalCredit: 0,
    totalPix: 0,
    salesCount: 0,
    totalExchangeDifferenceIn: 0,
    exchangeDifferenceCount: 0,
  });

  return {
    id: docRef.id,
    userId,
    userName,
    openedAt: now,
    closedAt: null,
    openingBalance,
    closingBalance: null,
    status: "OPEN",
    totalSales: 0,
    totalCash: 0,
    totalDebit: 0,
    totalCredit: 0,
    totalPix: 0,
    salesCount: 0,
    totalExchangeDifferenceIn: 0,
    exchangeDifferenceCount: 0,
  };
}

export async function closeCashRegister(registerId: string, closingBalance: number): Promise<CashRegister> {
  const now = new Date();
  await adminDb.collection("cashRegisters").doc(registerId).update({
    closedAt: Timestamp.fromDate(now),
    closingBalance,
    status: "CLOSED",
  });

  const doc = await adminDb.collection("cashRegisters").doc(registerId).get();
  return { id: doc.id, ...convertTimestamp<Omit<CashRegister, "id">>(doc.data()!) };
}

export async function updateCashRegisterSales(
  registerId: string,
  payments: PaymentMethod[],
  saleTotal: number
): Promise<void> {
  const cashAmount = payments.find((p) => p.method === "DINHEIRO")?.amount || 0;
  const debitAmount = payments.find((p) => p.method === "DEBITO")?.amount || 0;
  const creditAmount = payments.find((p) => p.method === "CREDITO")?.amount || 0;
  const pixAmount = payments.find((p) => p.method === "PIX")?.amount || 0;

  await adminDb.collection("cashRegisters").doc(registerId).update({
    totalSales: FieldValue.increment(saleTotal),
    totalCash: FieldValue.increment(cashAmount),
    totalDebit: FieldValue.increment(debitAmount),
    totalCredit: FieldValue.increment(creditAmount),
    totalPix: FieldValue.increment(pixAmount),
    salesCount: FieldValue.increment(1),
  });
}

export async function getCashRegisterOrders(registerId: string): Promise<Order[]> {
  const register = await adminDb.collection("cashRegisters").doc(registerId).get();
  if (!register.exists) return [];

  const registerData = register.data()!;
  const openedAt = registerData.openedAt;
  const closedAt = registerData.closedAt || Timestamp.now();

  const snapshot = await adminDb
    .collection("orders")
    .where("createdAt", ">=", openedAt)
    .where("createdAt", "<=", closedAt)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp<Omit<Order, "id">>(doc.data()),
  }));
}
