const API_BASE = 'http://127.0.0.1:8000/api';

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

async function refreshAccessToken() {
  const { refreshToken } = await getTokens();
  if (!refreshToken) return null;

  const res = await fetch(`${API_BASE}/auth/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: refreshToken }),
  });

  if (!res.ok) {
    await clearTokens();
    return null;
  }

  const data = await res.json();
  await saveTokens(data.access, data.refresh || refreshToken);
  return data.access;
}

async function authFetch(url, options = {}) {
  let { accessToken } = await getTokens();

  const doFetch = (token) =>
    fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await doFetch(accessToken);

  if (res.status === 401 && accessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  return res;
}

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
