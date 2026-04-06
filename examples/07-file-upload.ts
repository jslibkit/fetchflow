import { ApiHandler } from 'fetchflowx';

const api = new ApiHandler('https://api.example.com');
api.setAuthToken('my-token');

const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;

const formData = new FormData();
formData.append('file', fileInput.files![0]);
formData.append('description', 'Profile photo');

// Content-Type is intentionally NOT set — browser sets it with the multipart boundary
const { data } = await api.post<{ url: string }>('/upload', formData);
console.log('Uploaded to:', data.url);
