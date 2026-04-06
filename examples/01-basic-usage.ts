import { ApiHandler } from 'fetchflowx';

const api = new ApiHandler('https://api.example.com', {
  timeout: 10_000,
  headers: { 'X-Client': 'my-app' },
});

// GET with query params → GET /users?role=admin&page=1
const { data: users } = await api.get('/users', {
  params: { role: 'admin', page: 1 },
});

// POST with JSON body (Content-Type set automatically)
const { data: newUser } = await api.post('/users', {
  name: 'Alice',
  email: 'alice@example.com',
});

// PATCH, PUT, DELETE
await api.patch('/users/1', { name: 'Alice Smith' });
await api.put('/users/1', { name: 'Alice Smith', email: 'alice@example.com' });
await api.delete('/users/1');
