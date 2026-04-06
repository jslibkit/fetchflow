import { ApiError } from './api-error.js';

export type ApiErrorHandlerFn<T = unknown> = (error: ApiError) => T | Promise<T>;
export type ApiRangeHandler = { from: number; to: number; handler: ApiErrorHandlerFn };

export class ApiErrorHandler {
  private exact = new Map<number, ApiErrorHandlerFn>();
  private ranges: ApiRangeHandler[] = [];
  private named = new Map<string, ApiErrorHandlerFn>();
  private global: ApiErrorHandlerFn | null = null;

  on(status: number, handler: ApiErrorHandlerFn): this {
    this.exact.set(status, handler);
    return this;
  }

  onRange(from: number, to: number, handler: ApiErrorHandlerFn): this {
    this.ranges.push({ from, to, handler });
    return this;
  }

  onType(name: string, handler: ApiErrorHandlerFn): this {
    this.named.set(name, handler);
    return this;
  }

  onAny(handler: ApiErrorHandlerFn): this {
    this.global = handler;
    return this;
  }

  off(key: number | string): this {
    if (typeof key === 'number') {
      this.exact.delete(key);
    } else {
      this.named.delete(key);
    }
    return this;
  }

  offRange(from: number, to: number): this {
    this.ranges = this.ranges.filter((item) => item.from !== from || item.to !== to);
    return this;
  }

  clear(): this {
    this.exact.clear();
    this.ranges = [];
    this.named.clear();
    this.global = null;
    return this;
  }

  async handle<T = unknown>(error: ApiError): Promise<T> {
    if (error.status !== null && error.status !== undefined) {
      const exact = this.exact.get(error.status);
      if (exact) {
        const result = await exact(error);
        if (result !== undefined) return result as T;
        throw error;
      }

      for (const { from, to, handler } of this.ranges) {
        if (error.status >= from && error.status <= to) {
          const result = await handler(error);
          if (result !== undefined) return result as T;
          throw error;
        }
      }
    }

    const named = this.named.get(error.name);
    if (named) {
      const result = await named(error);
      if (result !== undefined) return result as T;
      throw error;
    }

    if (this.global) {
      const result = await this.global(error);
      if (result !== undefined) return result as T;
      throw error;
    }

    throw error;
  }
}

export const errorHandler = new ApiErrorHandler();
