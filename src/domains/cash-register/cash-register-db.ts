import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { CashRegister, FinancialMovementPaymentMethod, Order, PaymentMethod } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";
import { createFinancialAuditLog } from "@/domains/financial/financial-db";

type CashAdjustmentType = "SUPPLY" | "WITHDRAWAL";

type FiadoPaymentMovement = {
  id: string;
  type?: string;
  amount?: number;
  paymentMethod?: FinancialMovementPaymentMethod;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
};

function mapFinancialToOrderPaymentMethod(method?: FinancialMovementPaymentMethod): PaymentMethod["method"] {
  if (method === "cash") return "DINHEIRO";
  if (method === "pix") return "PIX";
  if (method === "credit") return "CREDITO";
  return "DEBITO";
}

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

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
    totalCashSupply: 0,
    totalCashWithdrawal: 0,
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
    totalCashSupply: 0,
    totalCashWithdrawal: 0,
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

export async function applyCashRegisterAdjustment(input: {
  registerId: string;
  type: CashAdjustmentType;
  amount: number;
  note?: string;
  actorId: string;
  actorRole: string;
}): Promise<CashRegister> {
  const amount = Number(input.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, "Valor da movimentação deve ser maior que zero");
  }

  const registerRef = adminDb.collection("cashRegisters").doc(input.registerId);
  const now = new Date();

  await adminDb.runTransaction(async (tx) => {
    const registerSnap = await tx.get(registerRef);
    if (!registerSnap.exists) {
      throw new HttpError(404, "Caixa não encontrado");
    }

    const data = registerSnap.data() as {
      status?: string;
      openingBalance?: number;
      totalCash?: number;
      totalCashSupply?: number;
      totalCashWithdrawal?: number;
    };

    if (data.status !== "OPEN") {
      throw new HttpError(400, "Caixa não está aberto");
    }

    const openingBalance = Number(data.openingBalance || 0);
    const totalCash = Number(data.totalCash || 0);
    const totalCashSupply = Number(data.totalCashSupply || 0);
    const totalCashWithdrawal = Number(data.totalCashWithdrawal || 0);
    const availableCash = openingBalance + totalCash + totalCashSupply - totalCashWithdrawal;

    if (input.type === "WITHDRAWAL" && amount > availableCash) {
      throw new HttpError(400, "Saldo em dinheiro insuficiente para sangria");
    }

    tx.update(registerRef, {
      ...(input.type === "SUPPLY"
        ? { totalCashSupply: FieldValue.increment(amount) }
        : { totalCashWithdrawal: FieldValue.increment(amount) }),
    });
  });

  await createFinancialAuditLog({
    action: "MANUAL_ADJUSTMENT",
    actorId: input.actorId,
    actorRole: input.actorRole,
    occurredAt: now,
    competencyMonth: toCompetencyMonth(now),
    relatedEntity: { kind: "cashRegister", id: input.registerId },
    payload: {
      adjustmentType: input.type,
      amount,
      note: input.note || null,
    },
  });

  const updatedDoc = await registerRef.get();
  return { id: updatedDoc.id, ...convertTimestamp<Omit<CashRegister, "id">>(updatedDoc.data()!) };
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

  const fiadoMovementsSnapshot = await adminDb
    .collection("financialMovements")
    .where("occurredAt", ">=", openedAt)
    .where("occurredAt", "<=", closedAt)
    .orderBy("occurredAt", "desc")
    .get();

  const fiadoPaymentEntries: Order[] = fiadoMovementsSnapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...convertTimestamp<Record<string, unknown>>(doc.data()),
    }) as FiadoPaymentMovement)
    .filter((movement) => movement.type === "FIADO_PAYMENT")
    .filter((movement) => {
      const metadata = movement.metadata as Record<string, unknown> | undefined;
      const movementRegisterId = String(metadata?.cashRegisterId || "").trim();
      const movementReceiverId = String(metadata?.receivedByUserId || "").trim();
      return movementRegisterId === registerId || movementReceiverId === registerData.userId;
    })
    .map((movement) => {
      const metadata = movement.metadata as Record<string, unknown> | undefined;
      const amount = Number(movement.amount || 0);
      const clientName = String(metadata?.clientName || "Cliente").trim() || "Cliente";
      const paymentMethod = mapFinancialToOrderPaymentMethod(
        movement.paymentMethod as FinancialMovementPaymentMethod | undefined
      );
      const occurredAt = movement.occurredAt instanceof Date ? movement.occurredAt : new Date();

      return {
        id: `fiado-payment-${movement.id}`,
        subtotal: amount,
        discount: 0,
        totalAmount: amount,
        payments: [{ method: paymentMethod, amount }],
        clientName: `pagamento ${clientName}`,
        createdAt: occurredAt,
      } as Order;
    });

  const orders = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp<Omit<Order, "id">>(doc.data()),
  }));

  return [...orders, ...fiadoPaymentEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
