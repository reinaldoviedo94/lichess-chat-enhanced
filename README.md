# Lichess Chat Enhanced

Extensión de Chrome (MV3) + servicio Django que agrega **emojis y packs de stickers personalizados al chat de lichess.org**, con packs gratuitos y packs de tienda.

- **URL del diagrama (verdad canónica):** <https://reinaldoviedo94.github.io/lichess-chat-enhanced/architecture.html>
- **Spec del diagrama:** [`docs/architecture.json`](docs/architecture.json)

---

## La verdad del sistema

> **El diagrama de `docs/architecture.html` es la fuente canónica de arquitectura de este repo.**
> Si el diagrama y el código discrepan, hay un bug: se arregla el código o se regenera el diagrama, pero nunca se deja la divergencia sin resolver.

El diagrama no es una ilustración decorativa. Cada nodo declara evidencia con `sources` (ruta y línea reales del repo) y `meta.repository.revision` fija el commit del que se trazó, así que Archify **verifica las referencias contra el checkout** antes de renderizar. Si mueves un endpoint, cambias un nombre de archivo o alteras el flujo, la validación falla y te obliga a actualizar el spec.

**Regla: si tocas código que aparece en el diagrama, regenera el diagrama en el mismo PR.**

### Cómo verlo

```bash
# Online (después de mergear en develop, el workflow lo publica solo)
open https://reinaldoviedo94.github.io/lichess-chat-enhanced/architecture.html

# Local, servido en http://127.0.0.1:8848
./docs/serve.sh
```

El HTML es standalone: funciona sin red, con `file://` directo, e incluye pan/zoom, temas claro/oscuro, buscador, *trace* de relaciones, vistas guiadas y export a PNG/SVG.

### Cómo regenerarlo

Requiere el skill [Archify](https://github.com/tt-a1i/archify) instalado (`npx skills add tt-a1i/archify -g`).

```bash
SKILL=~/.agents/skills/archify
REPO=~/Development/lichess/lichess-chat-enhanced
JSON=$REPO/docs/architecture.json
HTML=$REPO/docs/architecture.html

# 1. Validar (9 checks, perfil showcase)
node $SKILL/bin/archify.mjs validate architecture $JSON --repo-root $REPO --quality showcase

# 2. Entregar (congela el spec, renderiza, commit atómico del HTML)
node $SKILL/bin/archify.mjs deliver architecture $JSON $HTML --repo-root $REPO --quality showcase --json

# 3. Evidencia en navegador real (1440x900 y 2048x1320)
node $SKILL/bin/archify.mjs visual-check $HTML --json
```

`deliver` imprime el SHA-256 y los bytes del spec y del artefacto. `visual-check` deja receipts en `docs/architecture.visual-check.*` (ignorados por git a propósito: son evidencia de una sesión, no fuente).

Al regenerar, **actualiza a mano `meta.repository.revision`** con el SHA completo del commit que documentas.

---

## Estructura

```
clients/extensions/chrome/lichess-chat-enhanced/   Extensión Chrome MV3
├── manifest.json                                 content script, service worker, popup
├── webpack.config.js                              bundle a dist/
└── src/
    ├── content/content.js                         picker + reemplazo de :slug: en el chat
    ├── background/background.js                   catálogo, data URI, proxy de Lottie JSON
    ├── popup/popup.js                             login/registro y store de packs
    └── lib/api.js                                 cliente HTTP + refresh de token

services/lichess_chat_enhanced/                    API Django (uv / pyproject)
├── lichess_chat_enhanced/settings.py              DRF, SimpleJWT, CORS
├── accounts/                                      register, me (JWT)
└── emojis/                                        packs, emojis, adquisición
```

## Cómo correr

**Backend** (Python ≥ 3.12, con `uv`):

```bash
cd services/lichess_chat_enhanced
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser   # para /admin
uv run python manage.py runserver         # 127.0.0.1:8000
```

La API queda en `http://127.0.0.1:8000/api` y el admin en `/admin`.

**Extensión** (Node ≥ con pnpm 10):

```bash
cd clients/extensions/chrome/lichess-chat-enhanced
pnpm install
pnpm build        # o: pnpm dev  (watch)
```

Luego `chrome://extensions` → *Cargar descomprimida* → carpeta `dist/`.

## Decisiones de diseño relevantes

Estas no son obvias al leer el código y están explicadas en el diagrama:

1. **Imágenes estáticas como data URI.** `background.js` convierte cada PNG a data URI antes de devolver el catálogo. Sin esto, `img.src` apuntando a `http://` dentro de una página `https://` es *mixed content* y el navegador lo bloquea.
2. **Lottie por JSON vía el service worker.** Los emojis animados no pueden cargarse como `<img>`; el content script pide el JSON con `FETCH_JSON` y lo renderiza con `lottie.loadAnimation` en el contenedor del mensaje.
3. **El refresh del access token vive en el cliente.** `api.js` intercepta un 401, llama `/auth/token/refresh/` y reintenta una vez. No hay blacklist de refresh tokens en el backend.

## Estado del proyecto

**Inmaduro a propósito.** Issues abiertos en GitHub documentan lo que falta. Lo relevante antes de tocar otra cosa:

- Sin tests reales (los `tests.py` son boilerplate de `startapp`) y sin CI.
- `settings.py` tiene `SECRET_KEY` hardcodeada, `DEBUG = True` y `CORS_ALLOW_ALL_ORIGINS = True`.
- La adquisición de packs no implementa pagos.

## Licencia

Sin licencia declarada. Añadir una antes de publicar el repo.
