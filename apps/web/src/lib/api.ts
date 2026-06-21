import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

function resolveApiUrl() {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
  if (configuredUrl) return configuredUrl;

  if (typeof window === 'undefined') return 'http://localhost:3000';

  const devPorts = new Set(['5173', '5174', '5175', '4173']);
  if (devPorts.has(window.location.port)) {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  return window.location.origin;
}

// URL Backend API. Default mengikuti hostname browser agar akses LAN tidak kembali ke localhost device klien.
export const API_URL = resolveApiUrl();

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

// Interceptor untuk menyisipkan token secara otomatis ke setiap request
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor untuk menangani error 401 (Token Expired / Invalid)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const path = originalRequest?.url || '';
    const isAuthEndpoint = path.includes('/api/auth/login') || path.includes('/api/auth/refresh');

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true;
      try {
        const refreshResponse = await api.post('/api/auth/refresh');
        const accessToken = refreshResponse.data.access_token;
        const currentUser = useAuthStore.getState().user;

        if (!currentUser) throw new Error('Sesi pengguna tidak ditemukan');

        useAuthStore.getState().login(accessToken, currentUser);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    if (error.response?.status === 401 && isAuthEndpoint && !path.includes('/api/auth/login')) {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);
