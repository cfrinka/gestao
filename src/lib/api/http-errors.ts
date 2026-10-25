export class HttpError extends Error {
  readonly statusCode: number;
  readonly exposeMessage: boolean;

  constructor(statusCode: number, message: string, exposeMessage: boolean = true) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.exposeMessage = exposeMessage;
  }
}

export const INTERNAL_ERROR_MESSAGE = "Erro interno no servidor. Tente novamente.";

// Expected failures are thrown as HttpError with a message written for the person at the
// counter. Anything else is unexpected: its text may carry internals (Firestore paths, stack
// details), so it is logged server-side and never sent to the browser.
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : INTERNAL_ERROR_MESSAGE;
  return new HttpError(500, message, false);
}

/** "2026-10" → "10/2026" */
export function formatCompetencyMonth(month: string): string {
  const [year, monthPart] = month.split("-");
  return year && monthPart ? `${monthPart}/${year}` : month;
}

export function closedMonthError(month: string): HttpError {
  return new HttpError(409, `O mês ${formatCompetencyMonth(month)} já foi fechado no financeiro e não pode ser alterado.`);
}

export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta operação já foi enviada com outros dados. Atualize a tela e tente de novo.";
export const IDEMPOTENCY_IN_PROGRESS_MESSAGE = "Esta operação ainda está sendo processada. Aguarde um instante.";
export const IDEMPOTENCY_KEY_REQUIRED_MESSAGE = "Requisição incompleta. Atualize a tela e tente de novo.";
