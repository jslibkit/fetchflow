import { ApiHandler, ApiErrorHandler } from 'fetchflowx';

const errorHandler = new ApiErrorHandler()
  .on(401, () => {
    window.location.href = '/login';
  })
  .on(403, (err) => {
    console.error('Forbidden:', err.data);
  })
  .on(404, (err) => {
    console.warn('Not found:', err.url);
    return null; // return a value to "recover" (suppress the throw)
  })
  .onRange(500, 599, (err) => {
    alert(`Server error ${err.status}. Try again later.`);
  })
  .onAny((err) => {
    console.error('Unhandled API error', err);
  });

const api = new ApiHandler('https://api.example.com', { errorHandler });

// 404 → handler returns null → no throw, result is null
const result = await api.get('/maybe-missing');

// 500 → handler fires → then throws (handler returned undefined)
try {
  await api.get('/broken-endpoint');
} catch (err) {
  // err is ApiError
}
