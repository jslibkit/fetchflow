export type ErrorStatus = number | null;

export interface ApiErrorContext {
  status?: number | null;
  statusText?: string;
  data?: unknown;
  headers?: Record<string, string>;
  url?: string;
  method?: string;
  isTimeout?: boolean;
  isNetworkError?: boolean;
  cause?: unknown;
}

export class ApiError extends Error {
  status: ErrorStatus;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
  url: string;
  method: string;
  isTimeout: boolean;
  isNetworkError: boolean;

  constructor(message: string, context: ApiErrorContext = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = context.status ?? null;
    this.statusText = context.statusText ?? '';
    this.data = context.data ?? null;
    this.headers = context.headers ?? {};
    this.url = context.url ?? '';
    this.method = context.method ?? '';
    this.isTimeout = context.isTimeout ?? false;
    this.isNetworkError = context.isNetworkError ?? false;

    if (context.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = context.cause;
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }

  isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }

  isServerError(): boolean {
    return this.status !== null && this.status >= 500;
  }

  isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  isAborted(): boolean {
    return this.name === 'AbortError' || (!this.isTimeout && !this.isNetworkError && this.status === null);
  }
}
