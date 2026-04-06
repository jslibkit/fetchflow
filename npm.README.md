# fetchflow

> You didn't come here for another Axios wrapper. Neither did I when I built this.

`fetchflow` started as *"just a small helper"* — you know how that goes.

- "just one helper function"
- "okay maybe add interceptors"
- "hmm auth refresh would be nice"
- "why is this actually… good?"

So here we are. A fetch wrapper that handles the annoying parts — auth refresh, error normalization, multi-instance support — and stays out of your way for everything else.

**Zero dependencies. Built on native `fetch`. TypeScript-first.**

---

## 📦 Install

```bash
npm install @jslibkit/fetchflow
```

---

## ⚡ 30-Second Start

```ts
import { ApiHandler } from '@jslibkit/fetchflow';

const api = new ApiHandler('https://api.example.com');

const { data } = await api.get('/users');
// { data: [...], status: 200, ok: true, headers: {...} }
```

That's it. No config files, no plugins, no wrapping your whole app in a provider.

---

## 🔐 Auth That Doesn't Get in Your Way

Tell it where your token lives. It handles the rest.

```ts
api.setAuthProvider({
  getToken: () => localStorage.getItem('access_token'),

  refreshToken: async () => {
    const res = await fetch('/auth/refresh', { method: 'POST' });
    const { accessToken } = await res.json();
    localStorage.setItem('access_token', accessToken);
    return accessToken;
  },
});
```

**What happens on a 401:**

```
Request fails with 401
       ↓
refreshToken() fires — exactly once
       ↓
All other parallel 401s wait for the same refresh (no stampede)
       ↓
Every request retries with the new token
```

No race conditions. No duplicate refresh calls. No token stomping.

---

## 🧠 Interceptors

Tap into the request/response lifecycle without monkey-patching anything.

```ts
// Stamp every request with a trace ID
api.addRequestInterceptor((config) => {
  config.headers['X-Request-ID'] = crypto.randomUUID();
  return config;
});

// Log every response
api.addResponseInterceptor((res) => {
  console.log(`[${res.status}] ${res.url}`);
  return res;
});

// Handle errors globally
api.addErrorInterceptor((err) => {
  if (err.isNetworkError) showOfflineBanner();
  // no return → error still propagates
});
```

Remove them by ID when you're done:

```ts
const id = api.addRequestInterceptor(...);
api.removeRequestInterceptor(id);
```

Need interceptors just for one call?

```ts
await api.get('/sensitive', {
  interceptors: {
    request: [(config) => { config.headers['X-Audit'] = 'true'; return config; }],
  },
});

// Or skip all instance interceptors entirely
await api.get('/public', { skipInterceptors: true });
```

---

## 💥 Errors That Actually Tell You Something

Every error — HTTP, network, timeout, abort — comes out as an `ApiError` with the same shape.

```ts
try {
  await api.get('/data');
} catch (err) {
  err.status        // 404, 500, null (network/timeout)
  err.data          // parsed response body
  err.url           // which endpoint failed
  err.method        // which method was used
  err.isTimeout     // true if timed out
  err.isNetworkError // true if fetch itself failed

  // Helpers
  err.isAuthError()    // 401 or 403
  err.isClientError()  // 4xx
  err.isServerError()  // 5xx
  err.isAborted()      // manually cancelled
}
```

### Route errors by status code

```ts
import { ApiErrorHandler } from '@jslibkit/fetchflow';

const errorHandler = new ApiErrorHandler()
  .on(401, () => { window.location.href = '/login'; })
  .on(404, (err) => { console.warn('Missing:', err.url); return null; }) // return = suppress throw
  .onRange(500, 599, (err) => reportToMonitoring(err))
  .onAny((err) => console.error('Unhandled', err));

const api = new ApiHandler('https://api.example.com', { errorHandler });
```

---

## 🍴 Fork for Multiple Backends

One base instance. Scoped children per service. No config duplication.

```ts
const api = new ApiHandler('https://api.example.com');
api.setAuthProvider({ getToken: () => localStorage.getItem('token') });

// Inherits auth + headers, adds its own role header
const adminApi = api.fork({
  baseURL: 'https://api.example.com/admin',
  headers: { 'X-Role': 'admin' },
});

// Different host entirely
const analyticsApi = api.fork('https://analytics.myapp.com');
```

Children inherit everything: headers, interceptors, auth, timeout, error handler. Changes to the child don't affect the parent.

---

## ⏱️ Timeout & Cancellation

```ts
// Global default
api.setTimeout(10_000);

// Override per request
await api.get('/slow', { timeout: 2000 });

// Cancel manually
const controller = new AbortController();
await api.get('/stream', { signal: controller.signal });
controller.abort();
```

Timeout and external signal compose — whichever fires first wins.

---

## 📁 File Uploads Just Work

```ts
const form = new FormData();
form.append('avatar', file);

// Content-Type with multipart boundary is set automatically — don't touch it
const { data } = await api.post<{ url: string }>('/upload', form);
```

---

## 🔢 Everything Else

```ts
// Query params (arrays, nulls, Dates all handled)
api.get('/users', { params: { role: 'admin', ids: [1, 2, 3] } });
// → /users?role=admin&ids=1&ids=2&ids=3

// Headers
api.setHeader('X-Client', 'web');
api.setAuthToken('my-token');           // → Authorization: Bearer my-token
api.setAuthToken('key123', 'ApiKey');   // → Authorization: ApiKey key123

// Strip a header for one request only
api.get('/open', { headers: { Authorization: null } });

// Pre-built default instance
import { api } from '@jslibkit/fetchflow';
api.setBaseURL('https://api.example.com');
```

---

## 🚫 This is NOT for you if…

- You need a **GraphQL client** → Apollo, urql
- You need **heavy caching / stale-while-revalidate** → TanStack Query, SWR
- You're on **Node < 18** without a `fetch` polyfill

---

## ⚠️ What this library refuses to do

- ❌ Store your tokens
- ❌ Manage your auth state  
- ❌ Make assumptions about your backend

It gives you clean primitives and gets out of the way. The rest is yours.

---

## 📜 License

MIT — do whatever you want with it.

---

> *If this saves you even a few hours of rewriting the same fetch wrapper:*
> **mission accomplished. 🚀**

