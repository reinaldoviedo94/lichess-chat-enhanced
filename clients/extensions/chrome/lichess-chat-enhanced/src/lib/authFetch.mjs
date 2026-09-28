// `authFetch` como función inyectable (sin dependencias de chrome/fetch global para poder
// testearla en node). `api.js` construye la instancia real; los tests construyen una con fakes.
//
// Comportamiento (preserva el original de api.js):
//   - pide el accessToken, hace la petición con `Authorization: Bearer <token>`.
//   - si responde 401 Y había accessToken, intenta refrescar con el refreshToken.
//       * sin refreshToken → no hace nada (no reintenta, no limpia).
//       * POST a `refreshUrl` no ok → limpia tokens (clearTokens) y no reintenta.
//       * ok → guarda el par nuevo y reintenta la petición original con el access nuevo.

export function createAuthFetch({ getTokens, saveTokens, clearTokens, refreshUrl, fetchImpl }) {
  const request = (url, options = {}, token) =>
    fetchImpl(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  return async function authFetch(url, options = {}) {
    const { accessToken } = await getTokens();

    let res = await request(url, options, accessToken);

    if (res.status === 401 && accessToken) {
      const { refreshToken } = await getTokens();
      if (refreshToken) {
        const refreshRes = await request(refreshUrl, {
          method: 'POST',
          body: JSON.stringify({ refresh: refreshToken }),
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          await saveTokens(data.access, data.refresh || refreshToken);
          res = await request(url, options, data.access);
        } else {
          await clearTokens();
        }
      }
    }

    return res;
  };
}