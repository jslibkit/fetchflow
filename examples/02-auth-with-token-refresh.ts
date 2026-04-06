import { ApiHandler } from 'fetchflowx';

const api = new ApiHandler('https://api.example.com');

api.setAuthProvider({
  // Called on every request — attach current token
  getToken: () => localStorage.getItem('access_token'),

  // Called automatically on 401 — refresh and return new token
  refreshToken: async () => {
    const res = await fetch('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: localStorage.getItem('refresh_token') }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      localStorage.clear(); // logout
      return null;          // signals refresh failed — request won't retry
    }

    const { accessToken } = await res.json();
    localStorage.setItem('access_token', accessToken);
    return accessToken;
  },
});

// If this 401s, the token is refreshed once and the request retries automatically.
// If 10 parallel requests all 401, only ONE refresh call is made.
const { data } = await api.get('/me');
