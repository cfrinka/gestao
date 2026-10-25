import { HttpError, IDEMPOTENCY_CONFLICT_MESSAGE, IDEMPOTENCY_IN_PROGRESS_MESSAGE, IDEMPOTENCY_KEY_REQUIRED_MESSAGE } from "@/lib/api/http-errors";
import type { BillsRepository } from "@/domains/bills/repository";
import type {
  BillExecutionResult,
  BillRecord,
  CreateBillCommand,
  DeleteBillCommand,
  ListBillsQuery,
  MarkBillPaidCommand,
  MarkBillUnpaidCommand,
} from "@/domains/bills/types";

function toPublicErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

const ALLOWED_METHODS = ["DINHEIRO", "DEBITO", "CREDITO", "PIX"] as const;

export class BillsService {
  constructor(private readonly repository: BillsRepository) {}

  async list(query: ListBillsQuery): Promise<BillRecord[]> {
    return this.repository.listBills(query);
  }

  async create(command: CreateBillCommand): Promise<BillExecutionResult> {
    const safeIdempotencyKey = String(command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
    }

    const kind = typeof command.kind === "string" ? command.kind.toUpperCase() : "";
    const name = typeof command.name === "string" ? command.name.trim() : "";
    const amount = typeof command.amount === "number" ? command.amount : parseFloat(String(command.amount || 0));

    if (!name) throw new HttpError(400, "Informe o nome da conta");
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Valor inválido");

    let requestPayload: Record<string, unknown>;
    let runCreate: () => Promise<unknown>;

    if (kind === "FIXED") {
      const dayOfMonth =
        typeof command.dayOfMonth === "number" ? command.dayOfMonth : parseInt(String(command.dayOfMonth || ""), 10);
      const monthsAheadRaw =
        typeof command.monthsAhead === "number" ? command.monthsAhead : parseInt(String(command.monthsAhead || ""), 10);
      const startMonth = typeof command.startMonth === "string" ? command.startMonth : undefined;

      if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new HttpError(400, "Dia de vencimento inválido");
      }
      const monthsAhead = Number.isFinite(monthsAheadRaw) && monthsAheadRaw > 0 ? Math.min(36, monthsAheadRaw) : 12;

      requestPayload = { kind, name, amount, dayOfMonth, monthsAhead, startMonth: startMonth || null };
      runCreate = async () => ({
        kind: "FIXED",
        ...(await this.repository.createFixedBills({ name, amount, dayOfMonth, startMonth, monthsAhead })),
      });
    } else if (kind === "ONE_TIME") {
      const dueDate = typeof command.dueDate === "string" ? command.dueDate : "";
      if (!dueDate) throw new HttpError(400, "Informe a data de vencimento");

      requestPayload = { kind, name, amount, dueDate };
      runCreate = async () => ({
        kind: "ONE_TIME",
        ...(await this.repository.createOneTimeBill({ name, amount, dueDate })),
      });
    } else if (kind === "INSTALLMENTS" || kind === "INSTALLMENT") {
      const firstDueDate = typeof command.firstDueDate === "string" ? command.firstDueDate : "";
      const installmentsCountRaw =
        typeof command.installmentsCount === "number"
          ? command.installmentsCount
          : parseInt(String(command.installmentsCount || ""), 10);
      const intervalMonthsRaw =
        typeof command.intervalMonths === "number"
          ? command.intervalMonths
          : parseInt(String(command.intervalMonths || ""), 10);

      if (!firstDueDate) throw new HttpError(400, "Informe o primeiro vencimento");
      if (!Number.isFinite(installmentsCountRaw) || installmentsCountRaw <= 0) {
        throw new HttpError(400, "Número de parcelas inválido");
      }
      const intervalMonths = Number.isFinite(intervalMonthsRaw) && intervalMonthsRaw > 0 ? Math.min(12, intervalMonthsRaw) : 1;
      const installmentsCount = Math.min(60, installmentsCountRaw);

      requestPayload = { kind: "INSTALLMENTS", name, amount, firstDueDate, installmentsCount, intervalMonths };
      runCreate = async () => ({
        kind: "INSTALLMENTS",
        ...(await this.repository.createInstallments({ name, amount, firstDueDate, installmentsCount, intervalMonths })),
      });
    } else {
      throw new HttpError(400, "Tipo de conta inválido");
    }

    const requestHash = JSON.stringify({ ...requestPayload, userId: command.userId });

    const reservation = await this.repository.reserveIdempotency({
      ownerId: command.userId,
      idempotencyKey: safeIdempotencyKey,
      requestHash,
    });

    if (reservation.type === "conflict") {
      throw new HttpError(409, IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    if (reservation.type === "completed") {
      return { status: 200, body: reservation.response };
    }
    if (reservation.type === "in_progress") {
      return { status: 409, body: { error: IDEMPOTENCY_IN_PROGRESS_MESSAGE } };
    }

    try {
      const result = await runCreate();
      await this.repository.markIdempotencyCompleted({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        response: result,
      });
      return { status: 201, body: result };
    } catch (error) {
      await this.repository.markIdempotencyFailed({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        errorMessage: toPublicErrorMessage(error),
      });
      throw error;
    }
  }

  async markPaid(command: MarkBillPaidCommand): Promise<BillRecord> {
    if (command.actorRole !== "ADMIN") {
      throw new HttpError(403, "Só administradores podem alterar contas");
    }

    const { exists } = await this.repository.getBill(command.billId);
    if (!exists) {
      throw new HttpError(404, "Conta não encontrada");
    }

    const methodRaw = typeof command.method === "string" ? command.method : "DINHEIRO";
    const method = (ALLOWED_METHODS as readonly string[]).includes(methodRaw) ? methodRaw : "DINHEIRO";

    return this.repository.markBillPaid({ billId: command.billId, method, actorId: command.actorId });
  }

  async markUnpaid(command: MarkBillUnpaidCommand): Promise<BillRecord> {
    if (command.actorRole !== "ADMIN") {
      throw new HttpError(403, "Só administradores podem alterar contas");
    }

    const { exists } = await this.repository.getBill(command.billId);
    if (!exists) {
      throw new HttpError(404, "Conta não encontrada");
    }

    return this.repository.markBillUnpaid({ billId: command.billId, actorId: command.actorId });
  }

  async remove(command: DeleteBillCommand): Promise<void> {
    if (command.actorRole !== "ADMIN") {
      throw new HttpError(403, "Só administradores podem excluir contas");
    }

    const { exists } = await this.repository.getBill(command.billId);
    if (!exists) {
      throw new HttpError(404, "Conta não encontrada");
    }

    return this.repository.deleteBill({ billId: command.billId, actorId: command.actorId });
  }
}
