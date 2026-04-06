# fetchflow

A lightweight, zero-dependency fetch wrapper with interceptors, typed errors, pluggable auth, and automatic token refresh — built for real-world TypeScript apps.

## Features

- Zero dependencies — built on the native `fetch` API
- Full TypeScript support with generic response types
- Request / response / error interceptors
- Pluggable auth system — no assumptions about your token storage
- Automatic token refresh with concurrency safety (one refresh for N parallel 401s)
- `fork()` for scoped child instances (multi-backend, admin APIs, etc.)
- Normalized `ApiError` with status helpers
- Centralized error routing via `ApiErrorHandler`
- Timeout and `AbortSignal` support (composable)
- Smart body serialization — objects → JSON, FormData boundary handled automatically

## Installation

```bash
npm install fetchflow
```

## Quick Start

```ts
import { ApiHandler } from 'fetchflow';

const api = new ApiHandler('https://api.example.com');

const { data } = await api.get('/users');
```

---

## Core Concepts

### `ApiHandler`

The main HTTP client. Create one instance per backend.

```ts
const api = new ApiHandler('https://api.example.com', {
  timeout: 10_000,
  headers: { 'X-Client': 'my-app' },
});
```

#### Constructor options

| Option | Type | Description |
|---|---|---|
| `headers` | `Record<string, string>` | Default headers sent with every request |
| `timeout` | `number` | Request timeout in milliseconds (default: none) |
| `credentials` | `RequestCredentials` | Passed to `fetch` |
| `mode` | `RequestMode` | Passed to `fetch` |
| `errorHandler` | `ApiErrorHandler` | Centralized error handler instance |
| `authProvider` | `AuthProvider` | Token getter and refresh logic |

---

## HTTP Methods

```ts
api.get<T>(path, options?)
api.post<T>(path, data?, options?)
api.put<T>(path, data?, options?)
api.patch<T>(path, data?, options?)
api.delete<T>(path, options?)
api.head<T>(path, options?)
api.options<T>(path, options?)
```

All methods return `Promise<ApiResponse<T>>`:

```ts
interface ApiResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  ok: boolean;
}
```

### Query Parameters

```ts
// GET /users?role=admin&page=1
await api.get('/users', {
  params: { role: 'admin', page: 1 },
});
```

Arrays are expanded: `{ ids: [1, 2, 3] }` → `ids=1&ids=2&ids=3`.
`null` and `undefined` values are skipped. `Date` objects are serialized to ISO strings.

### Request Options

| Option | Type | Description |
|---|---|---|
| `data` | `unknown` | Request body |
| `params` | `Record<string, unknown>` | Query string parameters |
| `headers` | `Record<string, string \| null>` | Per-request headers (`null` removes a header) |
| `timeout` | `number` | Overrides instance timeout for this request |
| `signal` | `AbortSignal` | External cancellation signal |
| `credentials` | `RequestCredentials` | Overrides instance credentials |
| `mode` | `RequestMode` | Overrides instance mode |
| `cache` | `RequestCache` | Passed to `fetch` |
| `redirect` | `RequestRedirect` | Passed to `fetch` |
| `keepalive` | `boolean` | Passed to `fetch` |
| `skipInterceptors` | `boolean` | Bypass all instance-level interceptors |
| `interceptors` | `CallInterceptors` | Per-request interceptors |

---

## Auth

### Static Token

```ts
api.setAuthToken('my-jwt-token'); // sets Authorization: Bearer <token>
api.setAuthToken('key123', 'ApiKey'); // sets Authorization: ApiKey key123
api.clearAuth(); // removes Authorization header
```

### Auth Provider (with Automatic Refresh)

```ts
api.setAuthProvider({
  getToken: () => localStorage.getItem('access_token'),

  refreshToken: async () => {
    const res = await fetch('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: localStorage.getItem('refresh_token') }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      localStorage.clear();
      return null; // returning null cancels the retry
    }

    const { accessToken } = await res.json();
    localStorage.setItem('access_token', accessToken);
    return accessToken;
  },
});
```

**Refresh flow:** on a `401`, `refreshToken()` is called once. All concurrent requests that also 401 wait for the same refresh — no duplicate calls. The original request is retried with the new token. If refresh returns `null`, the error propagates normally.

---

## Interceptors

Interceptors run in the order they were added. Return the (modified) value to replace it; return `void` / nothing to pass it through unchanged.

### Request Interceptor

Receives and must return the `RequestConfig`.

```ts
const id = api.addRequestInterceptor((config) => {
  config.headers['X-Request-ID'] = crypto.randomUUID();
  return config;
});

api.removeRequestInterceptor(id);
```

### Response Interceptor

Receives and must return the `ApiResponse`.

```ts
api.addResponseInterceptor((response) => {
  console.log(`[${response.status}] ${response.url}`);
  return response;
});
```

### Error Interceptor

Receives an `ApiError`. Return a value to recover (suppresses the throw); return nothing to let it propagate.

```ts
api.addErrorInterceptor((err) => {
  if (err.isNetworkError) {
    console.warn('You appear to be offline');
  }
  // no return → error still throws
});
```

### Per-Request Interceptors

Run in addition to instance interceptors, only for that call.

```ts
await api.get('/sensitive', {
  interceptors: {
    request: [(config) => {
      config.headers['X-Audit'] = 'true';
      return config;
    }],
  },
});
```

### Skip All Interceptors

```ts
await api.get('/public', { skipInterceptors: true });
```

---

## Error Handling

All errors are normalized into `ApiError`:

```ts
class ApiError extends Error {
  status: number | null;
  statusText: string;
  data: unknown;        // parsed response body
  headers: Record<string, string>;
  url: string;
  method: string;
  isTimeout: boolean;
  isNetworkError: boolean;

  isClientError(): boolean  // 4xx
  isServerError(): boolean  // 5xx
  isAuthError(): boolean    // 401 or 403
  isAborted(): boolean      // manually cancelled
}
```

```ts
try {
  await api.get('/data');
} catch (err) {
  if (err.isAuthError())   { /* redirect to login */ }
  if (err.isNetworkError)  { /* show offline banner */ }
  if (err.isTimeout)       { /* show retry prompt */ }
  if (err.isServerError()) { /* log to monitoring */ }
}
```

### `ApiErrorHandler`

Route errors to handlers by status code, range, or type — attached at the instance level.

```ts
import { ApiErrorHandler, ApiHandler } from 'fetchflow';

const errorHandler = new ApiErrorHandler()
  .on(401, () => { window.location.href = '/login'; })
  .on(404, (err) => {
    console.warn('Not found:', err.url);
    return null; // returning a value suppresses the throw
  })
  .onRange(500, 599, (err) => {
    reportToMonitoring(err);
    // no return → error still throws after handler runs
  })
  .onAny((err) => {
    console.error('Unhandled error', err);
  });

const api = new ApiHandler('https://api.example.com', { errorHandler });
```

Handler resolution order: exact status → range → named type → catch-all (`onAny`).

---

## Forking Instances

`fork()` creates a child instance that inherits the parent's headers, interceptors, timeout, auth provider, and error handler. Overrides are applied on top.

```ts
const api = new ApiHandler('https://api.example.com', {
  headers: { 'X-Client': 'web' },
});

// Inherits everything, overrides base URL and adds a header
const adminApi = api.fork({
  baseURL: 'https://api.example.com/admin',
  headers: { 'X-Role': 'admin' },
});

// Shorthand — pass a string to only override the base URL
const analyticsApi = api.fork('https://analytics.external.com');
```

Changes to the child (headers, interceptors) do not affect the parent.

---

## Timeout and Cancellation

```ts
// Global timeout
api.setTimeout(5000);

// Per-request timeout override
try {
  await api.get('/slow', { timeout: 2000 });
} catch (err) {
  if (err.isTimeout) console.error('Timed out');
}

// Manual cancellation
const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);

try {
  await api.get('/long-poll', { signal: controller.signal });
} catch (err) {
  if (err.isAborted()) console.log('Cancelled');
}
```

Timeout and external signal are composable — whichever fires first aborts the request.

---

## File Uploads

```ts
const formData = new FormData();
formData.append('file', file);
formData.append('description', 'Profile photo');

// Do NOT set Content-Type manually — the browser sets it with the multipart boundary
const { data } = await api.post<{ url: string }>('/upload', formData);
```

---

## Header Management

```ts
api.setHeader('X-Custom', 'value');
api.setHeaders({ 'X-A': '1', 'X-B': '2' });
api.removeHeader('X-Custom');
api.clearHeaders();
api.getHeaders(); // returns current headers as a plain object
```

Header names are stored case-insensitively and deduplicated. The original casing is preserved in outgoing requests.

Per-request: pass `null` as a value to remove a default header for that call only.

```ts
await api.get('/public', {
  headers: { Authorization: null }, // strip auth for this request
});
```

---

## Default Instance

A pre-built instance is exported for simple use cases:

```ts
import { api } from 'fetchflow';

api.setBaseURL('https://api.example.com');
const { data } = await api.get('/ping');
```

---

## When to Use

- Lightweight alternative to Axios with no dependencies
- Apps that need full control over auth and token refresh
- Multi-backend apps (one instance per service)
- Projects that want typed, normalized errors without boilerplate

## When Not to Use

- GraphQL → use Apollo or urql
- Heavy caching / stale-while-revalidate → use TanStack Query or SWR
- Non-browser environments that do not have a native `fetch` (Node < 18 without a polyfill)

---

## License

MIT
