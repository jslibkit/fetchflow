import { ApiHandler } from 'fetchflowx';

const api = new ApiHandler('https://api.example.com', {
  headers: { 'X-Client': 'web' },
});

api.setAuthProvider({
  getToken: () => localStorage.getItem('token'),
});

// Admin fork: inherits auth + headers, adds its own base path and role header
const adminApi = api.fork({
  baseURL: 'https://api.example.com/admin',
  headers: { 'X-Role': 'admin' },
});

// External service fork: different base, same timeout
const analyticsApi = api.fork('https://analytics.external.com');

await adminApi.get('/dashboard');   // → https://api.example.com/admin/dashboard
await analyticsApi.post('/events'); // → https://analytics.external.com/events
