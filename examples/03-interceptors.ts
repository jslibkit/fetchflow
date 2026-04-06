import { ApiHandler } from 'fetchflowx';

const api = new ApiHandler('https://api.example.com');

// Request interceptor — modify config before sending
const reqId = api.addRequestInterceptor((config) => {
  config.headers['X-Request-ID'] = crypto.randomUUID();
  return config; // must return config to apply changes
});

// Response interceptor — log or transform responses
api.addResponseInterceptor((response) => {
  console.log(`[${response.status}] ${response.url}`);
  return response;
});

// Error interceptor — log errors centrally
api.addErrorInterceptor((err) => {
  if (err.isNetworkError) {
    console.warn('You appear to be offline');
  }
  // return nothing → error still throws
});

// Remove an interceptor by its symbol ID
api.removeRequestInterceptor(reqId);
