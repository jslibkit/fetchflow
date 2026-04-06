import { ApiHandler } from 'fetchflowx';

const api = new ApiHandler('https://api.example.com');

// Attach interceptors only for this specific call
const { data } = await api.get('/sensitive', {
  interceptors: {
    request: [(config) => {
      config.headers['X-Audit'] = 'true';
      return config;
    }],
    response: [(res) => {
      console.log('Sensitive data received');
      return res;
    }],
  },
});

// Skip all global interceptors for this call
const raw = await api.get('/public', { skipInterceptors: true });
