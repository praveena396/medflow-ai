'use client';

// Central API client: one place for the backend URL, auth headers,
// and automatic access-token refresh on expiry.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'patient' | 'doctor' | 'admin';
}

// ---------- session storage ----------
// Only the short-lived access token and the user's display details live in
// localStorage. The refresh token is an httpOnly cookie that JavaScript can't
// read; the browser sends it to /api/auth/* because of credentials: 'include'.
export const getToken = () => localStorage.getItem('token');
export const getUser = (): AuthUser | null => {
  const raw = localStorage.getItem('user');
  return raw ? (JSON.parse(raw) as AuthUser) : null;
};

export const saveSession = (data: { token: string; user?: AuthUser }) => {
  localStorage.setItem('token', data.token);
  if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
};

export const clearSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('refreshToken'); // left over from older versions
};

// Login and register: the response sets the refresh cookie.
export const authPost = (path: string, body: unknown) =>
  fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const logout = async () => {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // Offline: the local session is cleared anyway.
  }
  clearSession();
};

// ---------- refresh logic ----------
let refreshPromise: Promise<boolean> | null = null;

const tryRefresh = async (): Promise<boolean> => {
  // If several requests hit 401 at once, refresh only once and share the result.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include', // sends the httpOnly refresh cookie
        });
        if (!res.ok) return false;
        const data = await res.json();
        saveSession(data);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
};

// ---------- main fetch wrapper ----------
export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const buildHeaders = () => {
    const headers = new Headers(options.headers);
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // Don't set Content-Type for FormData — the browser adds the boundary itself.
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  };

  let response = await fetch(`${API_BASE}${path}`, { ...options, headers: buildHeaders() });

  // Access token expired? Refresh once and retry the original request.
  if (response.status === 401 || response.status === 403) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers: buildHeaders() });
    } else {
      clearSession();
      if (typeof window !== 'undefined') window.location.href = '/auth/login';
    }
  }

  return response;
};

// Convenience wrapper that parses JSON and throws on API errors.
export const apiJson = async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await apiFetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { message?: string }).message || `Request failed (${response.status})`);
  }
  return data as T;
};
