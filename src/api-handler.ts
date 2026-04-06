import { ApiError } from './api-error.js';
import { ApiErrorHandler } from './api-error-handler.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | string;
export type HeaderRecord = Record<string, string>;
export type HeaderInput = Record<string, string | null>;
export type Primitive = string | number | boolean;

export interface RequestConfig {
  url: string;
  method: string;
  headers: HeaderRecord;
  body?: BodyInit;
  credentials?: RequestCredentials;
  mode?: RequestMode;
  signal?: AbortSignal;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  duplex?: 'half';
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: HeaderRecord;
  url: string;
  ok: boolean;
}

export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig> | void;
export type ResponseInterceptor<T = unknown> = (response: ApiResponse<T>) => ApiResponse<T> | Promise<ApiResponse<T>> | void;
export type ErrorInterceptor = (error: ApiError) => unknown | Promise<unknown> | void;

export interface CallInterceptors {
  request?: RequestInterceptor[];
  response?: ResponseInterceptor[];
  error?: ErrorInterceptor[];
}

export interface RequestOptions {
  data?: unknown;
  params?: Record<string, unknown>;
  headers?: HeaderInput;
  timeout?: number;
  signal?: AbortSignal;
  skipInterceptors?: boolean;
  interceptors?: CallInterceptors;
  credentials?: RequestCredentials;
  mode?: RequestMode;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
}

export interface ApiHandlerOptions {
  headers?: HeaderRecord;
  timeout?: number;
  errorHandler?: ApiErrorHandler | null;
  credentials?: RequestCredentials;
  mode?: RequestMode;
  json?: boolean;
  authProvider?: AuthProvider | null;
}

export interface AuthProvider {
  getToken?: () => string | null | undefined;
  refreshToken?: () => Promise<string | null | undefined>;
}

type InternalRequestOptions = RequestOptions & {
  _retryCount?: number;
  _skipAuthRefresh?: boolean;
};

type InterceptorEntry<T> = { id: symbol; fn: T };
type PipelineEntry = { id: symbol; fn: (value: any) => any | Promise<any> | void };

interface HeaderEntry {
  name: string;
  value: string;
}

function isBodyInitLike(value: unknown): value is BodyInit {
  return typeof FormData !== 'undefined' && value instanceof FormData
    || typeof Blob !== 'undefined' && value instanceof Blob
    || typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams
    || typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer
    || ArrayBuffer.isView(value as ArrayBufferView)
    || typeof value === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export class ApiHandler {
  baseURL: string;
  private _timeout: number;
  private _errorHandler: ApiErrorHandler | null;
  private _credentials?: RequestCredentials;
  private _mode?: RequestMode;
  private _authProvider: AuthProvider | null = null;
  private _authRefreshPromise: Promise<string | null | undefined> | null = null;
  private _headers: Map<string, HeaderEntry>;
  private _interceptors: {
    request: Array<InterceptorEntry<RequestInterceptor>>;
    response: Array<InterceptorEntry<ResponseInterceptor>>;
    error: Array<InterceptorEntry<ErrorInterceptor>>;
  };

  constructor(baseURL = '', options: ApiHandlerOptions = {}) {
    this.baseURL = baseURL.replace(/\/+$/, '');
    this._timeout = options.timeout ?? 0;
    this._errorHandler = options.errorHandler ?? null;
    this._credentials = options.credentials;
    this._mode = options.mode;
    this._authProvider = options.authProvider ?? null;
    this._headers = new Map();
    this._interceptors = { request: [], response: [], error: [] };

    if (options.headers) {
      this.setHeaders(options.headers);
    }
  }

  setBaseURL(url: string): this {
    this.baseURL = url.replace(/\/+$/, '');
    return this;
  }

  setTimeout(timeout: number): this {
    this._timeout = Math.max(0, timeout);
    return this;
  }

  setAuthProvider(provider: AuthProvider | null): this {
    this._authProvider = provider;
    return this;
  }

  setAuthToken(token: string, scheme = 'Bearer'): this {
    return this.setHeader('Authorization', `${scheme} ${token}`);
  }

  clearAuth(): this {
    return this.removeHeader('Authorization');
  }

  setHeader(name: string, value: string): this {
    this._headers.set(name.toLowerCase(), { name, value });
    return this;
  }

  setHeaders(headers: HeaderRecord): this {
    for (const [name, value] of Object.entries(headers)) {
      this.setHeader(name, value);
    }
    return this;
  }

  removeHeader(name: string): this {
    this._headers.delete(name.toLowerCase());
    return this;
  }

  clearHeaders(): this {
    this._headers.clear();
    return this;
  }

  getHeaders(): HeaderRecord {
    const out: HeaderRecord = {};
    for (const { name, value } of this._headers.values()) {
      out[name] = value;
    }
    return out;
  }

  addRequestInterceptor(fn: RequestInterceptor): symbol {
    return this._addInterceptor('request', fn);
  }

  removeRequestInterceptor(id: symbol): this {
    return this._removeInterceptor('request', id);
  }

  addResponseInterceptor(fn: ResponseInterceptor): symbol {
    return this._addInterceptor('response', fn);
  }

  removeResponseInterceptor(id: symbol): this {
    return this._removeInterceptor('response', id);
  }

  addErrorInterceptor(fn: ErrorInterceptor): symbol {
    return this._addInterceptor('error', fn);
  }

  removeErrorInterceptor(id: symbol): this {
    return this._removeInterceptor('error', id);
  }

  fork(overrides: string | (ApiHandlerOptions & { baseURL?: string }) = {}): ApiHandler {
    const opts = typeof overrides === 'string' ? { baseURL: overrides } : overrides;
    const child = new ApiHandler(opts.baseURL ?? this.baseURL, {
      timeout: opts.timeout ?? this._timeout,
      errorHandler: opts.errorHandler ?? this._errorHandler,
      credentials: opts.credentials ?? this._credentials,
      mode: opts.mode ?? this._mode,
      authProvider: opts.authProvider ?? this._authProvider,
      headers: {},
    });

    child._headers = new Map();
    for (const { name, value } of this._headers.values()) {
      child.setHeader(name, value);
    }
    if (opts.headers) {
      child.setHeaders(opts.headers);
    }

    child._interceptors = {
      request: [...this._interceptors.request] as any,
      response: [...this._interceptors.response] as any,
      error: [...this._interceptors.error] as any,
    } as typeof child._interceptors;

    return child;
  }

  async request<T = unknown>(method: HttpMethod, path: string, options: InternalRequestOptions = {}): Promise<ApiResponse<T>> {
    const internalOptions = options as InternalRequestOptions;
    const url = this._buildURL(path, options.params);

    const defaultHeaders = this.getHeaders();
    const explicitHeaders = this._normalizeHeaders(options.headers);
    const headers = this._mergeHeaders(defaultHeaders, explicitHeaders);

    const requestData = options.data;
    let body: BodyInit | undefined;

    if (requestData !== undefined && requestData !== null) {
      if (isBodyInitLike(requestData)) {
        body = requestData;
        if (typeof FormData !== 'undefined' && requestData instanceof FormData) {
          this._removeHeaderKey(headers, 'content-type');
        }
      } else if (isPlainObject(requestData) || Array.isArray(requestData)) {
        body = JSON.stringify(requestData);
        if (!this._hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
      } else {
        body = String(requestData);
      }
    }

    if (this._authProvider?.getToken && !this._hasHeader(headers, 'authorization')) {
      const token = this._authProvider.getToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    let config: RequestConfig = {
      url,
      method: method.toUpperCase(),
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(options.credentials !== undefined ? { credentials: options.credentials } : this._credentials !== undefined ? { credentials: this._credentials } : {}),
      ...(options.mode !== undefined ? { mode: options.mode } : this._mode !== undefined ? { mode: this._mode } : {}),
      ...(options.cache !== undefined ? { cache: options.cache } : {}),
      ...(options.redirect !== undefined ? { redirect: options.redirect } : {}),
      ...(options.referrer !== undefined ? { referrer: options.referrer } : {}),
      ...(options.referrerPolicy !== undefined ? { referrerPolicy: options.referrerPolicy } : {}),
      ...(options.integrity !== undefined ? { integrity: options.integrity } : {}),
      ...(options.keepalive !== undefined ? { keepalive: options.keepalive } : {}),
    };

    const requestChain = [
      ...(options.skipInterceptors ? [] : this._interceptors.request),
      ...(options.interceptors?.request?.map((fn) => ({ id: Symbol('call-request'), fn })) ?? []),
    ];

    config = await this._runPipeline(requestChain as PipelineEntry[], config) as RequestConfig;

    const { signal, cleanup } = this._composeSignal(options.signal, options.timeout ?? this._timeout);

    try {
      const fetchInit: RequestInit = {
        method: config.method,
        headers: config.headers,
        ...(config.body !== undefined ? { body: config.body } : {}),
        ...(config.credentials !== undefined ? { credentials: config.credentials } : {}),
        ...(config.mode !== undefined ? { mode: config.mode } : {}),
        ...(config.cache !== undefined ? { cache: config.cache } : {}),
        ...(config.redirect !== undefined ? { redirect: config.redirect } : {}),
        ...(config.referrer !== undefined ? { referrer: config.referrer } : {}),
        ...(config.referrerPolicy !== undefined ? { referrerPolicy: config.referrerPolicy } : {}),
        ...(config.integrity !== undefined ? { integrity: config.integrity } : {}),
        ...(config.keepalive !== undefined ? { keepalive: config.keepalive } : {}),
        ...(signal ? { signal } : {}),
      };

      const response = await fetch(config.url, fetchInit);
      const responseData = await this._parseResponse(response, config.method);

      if (!response.ok) {
        throw new ApiError(
          `${config.method} ${config.url} → ${response.status} ${response.statusText}`,
          {
            status: response.status,
            statusText: response.statusText,
            data: responseData,
            headers: Object.fromEntries(response.headers.entries()),
            url: config.url,
            method: config.method,
          }
        );
      }

      let result: ApiResponse<T> = {
        data: responseData as T,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url: config.url,
        ok: true,
      };

      const responseChain = [
        ...(options.skipInterceptors ? [] : this._interceptors.response),
        ...(options.interceptors?.response?.map((fn) => ({ id: Symbol('call-response'), fn })) ?? []),
      ];

      result = await this._runPipeline(responseChain as PipelineEntry[], result) as ApiResponse<T>;
      return result;
    } catch (error) {
      if (this._isAbortError(error)) {
        throw new ApiError(
          options.timeout && options.timeout > 0 ? `Request timed out after ${options.timeout}ms` : this._timeout > 0 ? `Request timed out after ${this._timeout}ms` : 'Request was aborted',
          {
            url,
            method: config.method,
            isTimeout: true,
            cause: error,
          }
        );
      }

      const apiError = error instanceof ApiError
        ? error
        : new ApiError((error as Error)?.message || 'Network error', {
            url,
            method: config.method,
            isNetworkError: true,
            cause: error,
          });

      const shouldRetryAuth = !internalOptions._skipAuthRefresh
        && apiError.status === 401
        && this._authProvider?.refreshToken
        && (internalOptions._retryCount ?? 0) < 1;

      if (shouldRetryAuth) {
        const refreshed = await this._refreshAndSetToken();
        if (refreshed !== null) {
          return this.request<T>(method, path, {
            ...options,
            _retryCount: (internalOptions._retryCount ?? 0) + 1,
            _skipAuthRefresh: true,
          });
        }
      }

      const errorChain = [
        ...(options.skipInterceptors ? [] : this._interceptors.error),
        ...(options.interceptors?.error?.map((fn) => ({ id: Symbol('call-error'), fn })) ?? []),
      ];

      if (errorChain.length > 0) {
        try {
          const recovered = await this._runPipeline(errorChain as PipelineEntry[], apiError);
          if (recovered !== undefined) {
            return recovered as unknown as ApiResponse<T>;
          }
        } catch (handlerError) {
          throw handlerError instanceof ApiError ? handlerError : apiError;
        }
      }

      if (this._errorHandler) {
        const handled = await this._errorHandler.handle<ApiResponse<T>>(apiError);
        if (handled !== undefined) {
          return handled;
        }
      }

      throw apiError;
    } finally {
      cleanup();
    }
  }

  get<T = unknown>(path: string, options: Omit<RequestOptions, 'data'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  post<T = unknown>(path: string, data?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, { ...options, data });
  }

  put<T = unknown>(path: string, data?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, { ...options, data });
  }

  patch<T = unknown>(path: string, data?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, { ...options, data });
  }

  delete<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }

  head<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('HEAD', path, options);
  }

  options<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('OPTIONS', path, options);
  }

  private _addInterceptor<T>(kind: 'request' | 'response' | 'error', fn: T): symbol {
    const id = Symbol(`${kind}-interceptor`);
    this._interceptors[kind].push({ id, fn: fn as never });
    return id;
  }

  private _removeInterceptor(kind: 'request' | 'response' | 'error', id: symbol): this {
    (this._interceptors as any)[kind] = this._interceptors[kind].filter((item) => item.id !== id);
    return this;
  }

  private async _runPipeline(chain: PipelineEntry[], value: any): Promise<any> {
    let current = value;
    for (const item of chain) {
      const next = await item.fn(current);
      if (next !== undefined) {
        current = next;
      }
    }
    return current;
  }

  private _buildURL(path: string, params?: Record<string, unknown>): string {
    const isAbsolute = /^https?:\/\//i.test(path);
    let url = isAbsolute ? path : this.baseURL ? `${this.baseURL}/${path.replace(/^\/+/, '')}` : path.replace(/^\/+/, '');

    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item === null || item === undefined) continue;
            qs.append(key, this._stringifyQueryValue(item));
          }
        } else {
          qs.append(key, this._stringifyQueryValue(value));
        }
      }
      const query = qs.toString();
      if (query) {
        url += url.includes('?') ? `&${query}` : `?${query}`;
      }
    }

    return url;
  }

  private _stringifyQueryValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  private _normalizeHeaders(headers?: HeaderInput): HeaderRecord {
    const out: HeaderRecord = {};
    if (!headers) return out;
    for (const [key, value] of Object.entries(headers)) {
      if (value === null) continue;
      out[key] = value;
    }
    return out;
  }

  private _mergeHeaders(base: HeaderRecord, extra: HeaderRecord): HeaderRecord {
    const merged = { ...base };
    for (const [key, value] of Object.entries(extra)) {
      merged[key] = value;
    }
    return merged;
  }

  private _removeHeaderKey(headers: HeaderRecord, target: string): void {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === target.toLowerCase()) {
        delete headers[key];
      }
    }
  }

  private _hasHeader(headers: HeaderRecord, target: string): boolean {
    return Object.keys(headers).some((key) => key.toLowerCase() === target.toLowerCase());
  }

  private async _parseResponse(response: Response, method: string): Promise<unknown> {
    if (method.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 205) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    if (contentType.startsWith('text/') || contentType === '') {
      return response.text();
    }

    if (typeof response.blob === 'function') {
      return response.blob();
    }

    return response.arrayBuffer();
  }

  private _composeSignal(externalSignal?: AbortSignal, timeout = 0): { signal?: AbortSignal; cleanup: () => void } {
    if (!externalSignal && timeout <= 0) {
      return { cleanup: () => {} };
    }

    const controller = new AbortController();
    const cleanupFns: Array<() => void> = [];

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        const onAbort = () => controller.abort();
        externalSignal.addEventListener('abort', onAbort, { once: true });
        cleanupFns.push(() => externalSignal.removeEventListener('abort', onAbort));
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeout > 0) {
      timeoutId = setTimeout(() => controller.abort(), timeout);
      cleanupFns.push(() => clearTimeout(timeoutId));
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        for (const cleanupFn of cleanupFns) cleanupFn();
      }
    };
  }

  private _isAbortError(error: unknown): boolean {
    return !!error
      && typeof error === 'object'
      && 'name' in error
      && (error as { name?: string }).name === 'AbortError';
  }

  private async _refreshAndSetToken(): Promise<string | null> {
    if (!this._authProvider?.refreshToken) {
      return null;
    }

    if (!this._authRefreshPromise) {
      this._authRefreshPromise = (async () => {
        const nextToken = await this._authProvider!.refreshToken!();
        if (nextToken) {
          this.setAuthToken(nextToken);
          return nextToken;
        }
        this.clearAuth();
        return null;
      })().finally(() => {
        this._authRefreshPromise = null;
      });
    }

    const token = await this._authRefreshPromise;
    return token ?? null;
  }
}

export const api = new ApiHandler();
