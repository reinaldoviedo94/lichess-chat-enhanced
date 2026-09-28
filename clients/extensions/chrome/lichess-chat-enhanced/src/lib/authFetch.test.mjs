import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthFetch } from './authFetch.mjs';

/** Registra el historial de peticiones y respuestas configurables por URL. */
function makeFetch(routeHandlers) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers, body: options.body });
    const handler = routeHandlers(url, options);
    return {
      ok: handler.ok,
      status: handler.status,
      async json() { return handler.json; },
    };
  };
  return { calls, fetchImpl };
}

function harness(routeHandlers) {
  const { calls, fetchImpl } = makeFetch(routeHandlers);
  const store = { accessToken: 'old-access', refreshToken: 'old-refresh' };
  const getTokens = async () => store;
  const saveTokens = async (access, refresh) => { store.accessToken = access; if (refresh) store.refreshToken = refresh; };
  const clearTokens = async () => { delete store.accessToken; delete store.refreshToken; };
  const authFetch = createAuthFetch({
    getTokens, saveTokens, clearTokens,
    refreshUrl: 'http://api/auth/token/refresh/',
    fetchImpl,
  });
  return { calls, store, authFetch };
}

const bearer = (calls) => (calls.at(-1)?.headers?.Authorization || '').replace(/^Bearer /, '');

describe('authFetch', () => {
  it('petición simple con accessToken, sin refrescar', async () => {
    const { calls, authFetch } = harness(() => ({ ok: true, status: 200, json: { me: 'x' } }));
    const res = await authFetch('http://api/auth/me/');
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, 'Bearer old-access');
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
  });

  it('401 -> refresca -> reintenta con el access nuevo', async () => {
    let first = true;
    const { calls, store, authFetch } = harness((url) => {
      if (String(url).includes('/token/refresh/')) {
        return { ok: true, status: 200, json: { access: 'new-access', refresh: 'new-refresh' } };
      }
      if (first) { first = false; return { ok: false, status: 401, json: {} }; }
      return { ok: true, status: 200, json: { me: 'ok' } };
    });

    const res = await authFetch('http://api/auth/me/');

    assert.equal(res.status, 200);
    assert.equal(calls.length, 3); // original 401, refresh, retry
    assert.equal(bearer(calls), 'new-access'); // el retry (última llamada) lleva el access nuevo
    assert.equal(store.accessToken, 'new-access');
    assert.equal(store.refreshToken, 'new-refresh');
  });

  it('401 -> refresh falla -> limpia tokens y no reintenta', async () => {
    const { calls, store, authFetch } = harness((url) => {
      if (String(url).includes('/token/refresh/')) return { ok: false, status: 401, json: { detail: 'bad refresh' } };
      return { ok: false, status: 401, json: {} };
    });

    const res = await authFetch('http://api/auth/me/');

    assert.equal(res.status, 401);
    assert.equal(calls.length, 2); // original + refresh, sin retry
    assert.equal(store.accessToken, undefined);
    assert.equal(store.refreshToken, undefined); // clearTokens borró ambos
  });

  it('401 sin refreshToken -> no limpia y no reintenta', async () => {
    const { calls, store, authFetch } = harness((url) => {
      if (String(url).includes('/token/refresh/')) return { ok: true, status: 200, json: { access: 'x' } };
      return { ok: false, status: 401, json: {} };
    });
    store.refreshToken = undefined; // no hay refresh que usar

    const res = await authFetch('http://api/auth/me/');

    assert.equal(res.status, 401);
    assert.equal(calls.length, 1); // sin refresh ni retry
    assert.equal(store.accessToken, 'old-access'); // no se limpió
  });

  it('401 sin accessToken inicial -> no refresca (acceso anónimo sigue 401)', async () => {
    const { calls, store, authFetch } = harness(() => ({ ok: false, status: 401, json: {} }));
    delete store.accessToken; // sin accessToken que refrescar

    const res = await authFetch('http://api/auth/me/');

    assert.equal(res.status, 401);
    assert.equal(calls.length, 1); // ni refresh ni retry
  });
});