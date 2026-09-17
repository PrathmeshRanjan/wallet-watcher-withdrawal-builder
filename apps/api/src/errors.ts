export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "INSUFFICIENT_FUNDS", details);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(message, 502, "UPSTREAM_ERROR");
  }
}

