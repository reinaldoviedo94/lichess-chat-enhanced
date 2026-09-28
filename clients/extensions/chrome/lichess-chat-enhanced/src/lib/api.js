import { createAuthFetch } from './authFetch.mjs';

// Horneado por webpack.DefinePlugin en build-time. En local (sin definir) cae al
// backend de desarrollo; en CI/CD llega desde el secret API_BASE. El guard
// typeof× permite leer el fuente también fuera de webpack (p. ej. en node).
const API_BASE =
  (typeof __LCE_API_BASE__ !== 'undefined' && __LCE_API_BASE__) ||
  'http://127.0.0.1:8000/api';

async function getTokens() {
  const data = await chrome.storage.local.get(['accessToken', 'refreshToken']);
  return data;
}

async function saveTokens(access, refresh) {
  await chrome.storage.local.set({
    accessToken: access,
    refreshToken: refresh,
  });
}

async function clearTokens() {
  await chrome.storage.local.remove(['accessToken', 'refreshToken']);
}

// authFetch se construye con la inyección real (chrome.storage + fetch global).
// La lógica vive en authFetch.mjs y es testeable en node con fakes.
const authFetch = createAuthFetch({
  getTokens,
  saveTokens,
  clearTokens,
  refreshUrl: `${API_BASE}/auth/token/refresh/`,
  fetchImpl: fetch,
});

export const api = {
  async register(email, username, password) {
    const res = await fetch(`${API_BASE}/auth/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });
    return { ok: res.ok, data: await res.json() };
  },

  async login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      await saveTokens(data.access, data.refresh);
    }
    return { ok: res.ok, data };
  },

  async logout() {
    await clearTokens();
  },

  async me() {
    const res = await authFetch(`${API_BASE}/auth/me/`);
    if (!res.ok) return null;
    return res.json();
  },

  async getFreePacks() {
    const res = await fetch(`${API_BASE}/emojis/free/`);
    if (!res.ok) return [];
    return res.json();
  },

  async getMyPacks() {
    const res = await authFetch(`${API_BASE}/emojis/my-packs/`);
    if (!res.ok) return [];
    return res.json();
  },

  async getStorePacks() {
    const res = await authFetch(`${API_BASE}/emojis/store/`);
    if (!res.ok) return [];
    return res.json();
  },

  async acquirePack(slug) {
    const res = await authFetch(`${API_BASE}/emojis/store/${slug}/acquire/`, {
      method: 'POST',
    });
    return { ok: res.ok, data: await res.json() };
  },

  getTokens,
  clearTokens,
};
