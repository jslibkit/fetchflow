import { ApiHandler } from 'fetchflowx';

const api = new ApiHandler('https://api.example.com');

// Global timeout — applies to all requests
api.setTimeout(5000);

// Per-request timeout override (ms)
try {
  await api.get('/slow-endpoint', { timeout: 2000 });
} catch (err) {
  if (err.isTimeout) {
    console.error('Request timed out after 2s');
  }
}

// Manual cancellation via AbortController
const controller = new AbortController();

setTimeout(() => controller.abort(), 3000); // cancel after 3s

try {
  await api.get('/stream', { signal: controller.signal });
} catch (err) {
  if (err.isAborted()) {
    console.log('Request was cancelled');
  }
}
