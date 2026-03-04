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

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : "Internal server error";
  return new HttpError(500, message, false);
}
