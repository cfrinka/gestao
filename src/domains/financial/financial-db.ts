import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { FinancialAuditAction } from "@/lib/db-types";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function isFinancialMonthClosed(month: string): Promise<boolean> {
  const closure = await adminDb.collection("financialClosures").doc(month).get();
  return closure.exists;
}

export async function assertFinancialMonthOpen(date: Date): Promise<void> {
  const month = toCompetencyMonth(date);
  const closed = await isFinancialMonthClosed(month);
  if (closed) {
    throw new Error(`Financial month ${month} is closed`);
  }
}

export async function createFinancialAuditLog(input: {
  action: FinancialAuditAction;
  actorId: string;
  actorRole: string;
  occurredAt?: Date;
  competencyMonth?: string;
  relatedEntity?: { kind: string; id: string };
  payload?: Record<string, unknown>;
}): Promise<void> {
  const occurredDate =
    input.occurredAt instanceof Date && !Number.isNaN(input.occurredAt.getTime()) ? input.occurredAt : new Date();

  await adminDb.collection("financialAuditLogs").add({
    action: input.action,
    actorId: input.actorId,
    actorRole: input.actorRole,
    occurredAt: Timestamp.fromDate(occurredDate),
    ...(input.competencyMonth ? { competencyMonth: input.competencyMonth } : {}),
    ...(input.relatedEntity ? { relatedEntity: input.relatedEntity } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
  });
}
