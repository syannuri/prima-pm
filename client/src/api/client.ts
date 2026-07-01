// Thin fetch wrapper: injects the bearer token, auto-refreshes on 401, parses JSON.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

const TOKEN_KEY = 'prima_token';
const REFRESH_KEY = 'prima_refresh';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setRefresh: (t: string) => localStorage.setItem(REFRESH_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

// Exchange the refresh token for a fresh access token. Deduped so a burst of 401s
// (e.g. several parallel queries when the access token expires) triggers ONE refresh.
let refreshInFlight: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  const rt = tokenStore.getRefresh();
  if (!rt) return Promise.resolve(false);
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json().catch(() => null);
        if (data?.accessToken) {
          tokenStore.set(data.accessToken);
          return true;
        }
        return false;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function authHeader(base: Record<string, string> = {}): Record<string, string> {
  const token = tokenStore.get();
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: authHeader({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Access token likely expired → refresh once and retry the original request.
  if (res.status === 401 && !retried && path !== '/auth/refresh' && path !== '/auth/login') {
    if (await tryRefresh()) return request<T>(method, path, body, true);
    tokenStore.clear();
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401) tokenStore.clear();
    throw new ApiError(res.status, err.message ?? res.statusText, err.code, err.details);
  }
  return data as T;
}

// Authenticated file download: fetch as blob (Bearer header) then trigger save.
async function download(path: string, fallbackName: string, retried = false): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeader() });
  if (res.status === 401 && !retried) {
    if (await tryRefresh()) return download(path, fallbackName, true);
    tokenStore.clear();
  }
  if (!res.ok) {
    throw new ApiError(res.status, 'Download failed');
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const name = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Multipart upload (FormData): do NOT set Content-Type (browser sets the boundary).
async function upload<T>(path: string, formData: FormData, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: authHeader(), body: formData });
  if (res.status === 401 && !retried) {
    if (await tryRefresh()) return upload<T>(path, formData, true);
    tokenStore.clear();
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.message ?? res.statusText, err.code);
  }
  return data as T;
}

export const api = {
  download,
  upload,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
