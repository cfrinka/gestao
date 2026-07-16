import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreCashRegisterRepository } from "@/domains/cash-register/firestore-cash-register-repository";
import { InMemoryCashRegisterRepository } from "@/domains/cash-register/in-memory-cash-register-repository";
import type { CashRegisterRepository } from "@/domains/cash-register/repository";

export function getCashRegisterRepository(): CashRegisterRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryCashRegisterRepository(dataset.cashRegisters, dataset.orders, dataset.idempotency.cashRegister);
  }
  return new FirestoreCashRegisterRepository();
}
