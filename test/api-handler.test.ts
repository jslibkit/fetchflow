import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiHandler, ApiError } from '../src/index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('get builds absolute URL and parses json', async () => {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.example.com/users');
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const api = new ApiHandler('https://api.example.com');
  const res = await api.get<{ ok: boolean }>('/users');
  assert.equal(res.data.ok, true);
});

test('401 refreshes once and retries', async () => {
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('unauthorized', { status: 401 });
    }
    return new Response(JSON.stringify({ refreshed: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  let refreshCalls = 0;
  const api = new ApiHandler('https://api.example.com', {
    authProvider: {
      getToken: () => 'old-token',
      refreshToken: async () => {
        refreshCalls += 1;
        return 'new-token';
      }
    }
  });

  const res = await api.get<{ refreshed: boolean }>('/secure');
  assert.equal(res.data.refreshed, true);
  assert.equal(refreshCalls, 1);
  assert.equal(calls, 2);
});

test('retry guard stops a second refresh cycle', async () => {
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response('unauthorized', { status: 401 });
  };

  let refreshCalls = 0;
  const api = new ApiHandler('https://api.example.com', {
    authProvider: {
      getToken: () => 'old-token',
      refreshToken: async () => {
        refreshCalls += 1;
        return 'new-token';
      }
    }
  });

  await assert.rejects(() => api.get('/secure'));
  assert.equal(refreshCalls, 1);
  assert.equal(calls, 2);
});

test('throws ApiError on network-like failure', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const api = new ApiHandler('https://api.example.com');
  await assert.rejects(
    () => api.get('/users'),
    (error: unknown) => error instanceof ApiError && error.isNetworkError === true
  );
});

