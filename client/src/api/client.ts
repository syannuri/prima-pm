// Thin fetch wrapper: injects the bearer token, auto-refreshes on 401, parses JSON.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

const TOKEN_KEY = 'prima_token';
const REFRESH_KEY = 'prima_refresh';

// Auth tokens live in sessionStorage, so each browser TAB gets its own independent
// session — you can be signed in as different users in different tabs. (Theme and
// other preferences stay in localStorage.) Trade-off: closing a tab ends its
// session, and a new tab starts signed out.
const store = window.sessionStorage;

// One-time migration: carry an existing localStorage session into this tab so the
// switch to sessionStorage doesn't sign current users out. After moving it we clear
// the shared localStorage copy so tabs stop sharing a single session going forward.
if (!store.getItem(TOKEN_KEY)) {
  const legacyToken = localStorage.getItem(TOKEN_KEY);
  if (legacyToken) {
    store.setItem(TOKEN_KEY, legacyToken);
    const legacyRefresh = localStorage.getItem(REFRESH_KEY);
    if (legacyRefresh) store.setItem(REFRESH_KEY, legacyRefresh);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}

// Auth now lives in httpOnly cookies set by the server (unreadable by JS → XSS can't steal
// them). tokenStore is retained only to READ legacy sessionStorage tokens (so already-signed-in
// users and the JWT-mint test workflow keep working) and to CLEAR them once migrated. New
// logins write nothing here — the cookies are the session.
export const tokenStore = {
  get: () => store.getItem(TOKEN_KEY),
  getRefresh: () => store.getItem(REFRESH_KEY),
  clear: () => {
    store.removeItem(TOKEN_KEY);
    store.removeItem(REFRESH_KEY);
  },
};

// --- CSRF (double-submit) ---------------------------------------------------------------
// The server sets a JS-readable prima_csrf cookie alongside the httpOnly auth cookies. We
// echo it in an X-CSRF-Token header on state-changing requests; the server rejects a
// cookie-authenticated mutation whose header doesn't match (an attacker on another origin
// can't read the cookie). Bearer-authed (legacy) requests are exempt server-side.
const CSRF_COOKIE = 'prima_csrf';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | null {
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

function csrfHeader(method: string): Record<string, string> {
  if (!MUTATING.has(method.toUpperCase())) return {};
  const token = readCookie(CSRF_COOKIE);
  return token ? { 'X-CSRF-Token': token } : {};
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

// One-time migration for users signed in before the cookie switch: exchange the legacy
// sessionStorage refresh token for a fresh, cookie-based session, then drop the JS-readable
// tokens. No CSRF header needed — there's no prima_csrf cookie yet, so the server treats this
// refresh as an un-CSRF-able bootstrap. Best-effort: on failure the legacy tokens stay and
// still work via the Bearer fallback until they expire.
export async function migrateLegacyTokens(): Promise<void> {
  const legacy = tokenStore.getRefresh();
  if (!legacy) return;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: legacy }),
    });
    if (res.ok) tokenStore.clear();
  } catch {
    /* keep legacy tokens; they still authenticate via the Bearer fallback */
  }
}

// Exchange the refresh token for a fresh access token. Deduped so a burst of 401s
// (e.g. several parallel queries when the access token expires) triggers ONE refresh.
let refreshInFlight: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    // The refresh token rides in the httpOnly prima_rt cookie; a legacy sessionStorage token
    // (if any) is sent in the body as a fallback. The server rotates and sets fresh cookies.
    const legacy = tokenStore.getRefresh();
    refreshInFlight = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeader('POST') },
      body: JSON.stringify(legacy ? { refreshToken: legacy } : {}),
    })
      .then((res) => {
        if (!res.ok) return false;
        // Session is now carried by the rotated cookies — drop any legacy JS-readable tokens
        // so subsequent requests use the cookies (and can't be XSS-stolen).
        tokenStore.clear();
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Legacy Bearer header from sessionStorage, only present for pre-cookie sessions / the
// JWT-mint test workflow. New sessions authenticate via the httpOnly cookie instead.
function authHeader(base: Record<string, string> = {}): Record<string, string> {
  const token = tokenStore.get();
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: { ...authHeader({ 'Content-Type': 'application/json' }), ...csrfHeader(method) },
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
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', headers: authHeader() });
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
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...authHeader(), ...csrfHeader('POST') },
    body: formData,
  });
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
