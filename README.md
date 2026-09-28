# Lichess Chat Enhanced

Extensión de Chrome (MV3) + servicio Django que agrega **emojis y packs de stickers personalizados al chat de lichess.org**, con packs gratuitos y packs de tienda.

- **URL del diagrama (verdad canónica):** <https://reinaldoviedo94.github.io/lichess-chat-enhanced/architecture.html>
- **Spec del diagrama:** [`docs/architecture.json`](docs/architecture.json)
- **Índice de diagramas:** <https://reinaldoviedo94.github.io/lichess-chat-enhanced/>

> El diagrama del plano ToolJet (`docs/tooljet.html`) quedó **archivado** por la decisión de
> descartar ToolJet; ya no está en el índice.

Hay dos diagramas, con el mismo nivel de autoridad:

| Diagrama | Responde a |
|---|---|
| [Arquitectura](https://reinaldoviedo94.github.io/lichess-chat-enhanced/architecture.html) | Cómo se compone el sistema en ejecución: extensión, service worker, API, auth, almacenamiento. |
| [Cómo se verifica un cambio](https://reinaldoviedo94.github.io/lichess-chat-enhanced/verification.html) | Del `src` a la comprobación: build, seed, API local, harness, y qué bloquea hoy la vía automatizada. |

---

## La verdad del sistema

> **Los diagramas de `docs/` son la fuente canónica de arquitectura de este repo.**
> Si un diagrama y el código discrepan, hay un bug: se arregla el código o se regenera el diagrama, pero nunca se deja la divergencia sin resolver.

Los diagramas no son ilustraciones decorativas. Cada componente declara evidencia con `sources` (ruta y línea reales del repo) y `meta.repository.revision` fija el commit del que se trazó, así que Archify **verifica las referencias contra el checkout** antes de renderizar. Si mueves un endpoint, cambias un nombre de archivo o alteras el flujo, la validación falla y te obliga a actualizar el spec.

**Regla: si tocas código que aparece en un diagrama, regeneras el diagrama en el mismo PR.**

### Cómo verlos

```bash
# Online
open https://reinaldoviedo94.github.io/lichess-chat-enhanced/

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

Comprobado en esta sesión: el `viewBox` manda en la legibilidad a 1440px (el subtexto de 9px necesita escala ≥ 0,667, así que el ancho del viewBox no puede pasar de ~1390) y `visual-check` puede reprobar por unos pocos píxeles de overflow vertical que `validate` no detecta. Hay que iterar con los dos, no solo con `validate`.

---

## UX/UI del picker

> **ToolJet quedó descartado (2026-09-27).** La vía de automatizar el diseño con ToolJet (MCP +
> skill + contenedor local) se probó y se abandonó: la instancia local corría una licencia inválida
> que bloqueaba justo la feature que necesitábamos (temas), y la configuración MCP se retiró. Se
> sigue con el rediseño en la ruta de siempre: CSS nativo + design tokens en git.

El rediseño del menú de emojis (lenguaje shadcn con estética del selector de WhatsApp) está **en
marcha con el stack nativo de la extensión**: vanilla JS + CSS con design tokens.

| Documento | Qué es |
|---|---|
| [`docs/design/tokens.json`](docs/design/tokens.json) | **Contrato de design tokens** (light/dark, paleta WhatsApp, radios, espaciados). Fuente de verdad, se edita a mano. |
| [`scripts/tokens-to-css.mjs`](scripts/tokens-to-css.mjs) | Genera `src/content/tokens.css` y `src/popup/tokens.css` desde el contrato. `--check` sirve para CI. |
| [`docs/specs/ux-ui-tooljet.md`](docs/specs/ux-ui-tooljet.md) | Guía de diseño histórica: anatomía del panel, interacciones, a11y WCAG 2.2 AA, fases y criterios de aceptación. |

Decisiones:

- **La UI se queda en vanilla JS + CSS.** shadcn aquí es un lenguaje (tokens, radios, estados de
  interacción) portado a CSS, no el runtime de React. El bundle no crece.
- **Los tokens son la fuente de verdad:** hoy se escriben a mano en `tokens.json` y se versionan en
  git (un script los vuelca a `tokens.css`); no dependen de ninguna herramienta externa.
- La parte de la vida del picker de P1 **ya está hecha**: antes el panel moría si lila
  re-renderizaba el chat; ahora un observador permanente re-monta y des-monta limpiamente, con
  test en `e2e/lifecycle.test.mjs`.

Apunte histórico (por qué y qué se descartó):

- ToolJet llegó a evaluarse como **plano de diseño y de operación, no runtime**, y se descartó por
  la licencia local inválida. El picker vive en un content script MV3 bajo la CSP de lichess.org,
  con el catálogo ya resuelto a data URI; un bundle de ToolJet o un `<iframe>` remoto no cabe ahí
  (embed además es plan Team).
- **Lo único que cruza de diseño a runtime son los design tokens**: la paleta se mantiene en
  `docs/design/tokens.json` y de ahí a `tokens.css`. Mismo esquema `brand / text / border / surface
  / systemStatus` que usa shadcn, así que el mapeo es 1:1.
- De paso, el rediseño **cierra el bug conocido** de re-inicialización: hoy el panel desaparece si
  lila re-renderiza el chat.

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

## Dónde existe el chat en lichess (verificado en el código de lila)

No es en todas partes. De `lichess-org/lila`:

```scala
// modules/round/src/main/RoundGame.scala
def hasChat = !g.isTournament && !g.isSimul && !g.isSwiss && g.nonAi
```

Y de `app/controllers/Round.scala#getPlayerChat`: un torneo usa el chat **del evento**, un
simul el del simul, un swiss el del swiss. En cualquier otro caso, `game.hasChat` da un chat
**por partida**.

Consecuencias para probar:

- **Un match casual 1v1 sí tiene chat**, pero los dos jugadores deben estar **logueados**.
  Para un anónimo el chat queda `restricted = true`: solo presets, y el input no es usable
  (`placeholder = i18n.site.loginToChat`).
- No puede ser contra la IA, ni de torneo, simul o swiss.
- `.mchat__say` es un `<input type="text" maxlength="140">`, **no un `textarea`**.
- El chat se renderiza como `section.mchat` > `div.mchat__content.<tabKey>` > `ol.mchat__messages`.
  El *content script* observa `.mchat__content` y hace `TreeWalker` sobre los text nodes, que
  incluye un nodo de texto suelto (`" "`) entre el link del usuario y el texto del mensaje.

## Datos de prueba

```bash
cd services/lichess_chat_enhanced
uv run python manage.py seed_demo_packs
```

Crea dos packs con assets reales: **smileys** (gratis, 6 PNG generados con Pillow + 1 Lottie
JSON) y **chess-plus** (de pago, 4 + 1). Es idempotente. Sirve para ejercitar los dos caminos
que importan: los PNG pasan por el conversor a data URI y el Lottie por `FETCH_JSON`.

## Pruebas end-to-end

Hay un harness que replica el DOM del chat de lila para ejercitar la extensión **real** sin
necesitar sesión de lichess:

```bash
cd clients/extensions/chrome/lichess-chat-enhanced
node e2e/run.mjs
```

Detalles yLimitación conocida en [`e2e/README.md`](clients/extensions/chrome/lichess-chat-enhanced/e2e/README.md).
Resumen honesto: **la vía automatizada no funciona todavía en esta máquina.** Playwright no
expone de forma fiable el service worker MV3 de una extensión sin empaquetar (arranca antes de
que Playwright se conecte, y Chrome ignora `--load-extension` bajo algunos de los argumentos
por defecto de Playwright). El script sale con código `3` y explica el procedimiento manual en
vez de reportar un verde falso. La vía manual (cargar `dist/` en Chrome y abrir el harness)
funciona y es la fuente de verdad por ahora.

## Decisiones de diseño relevantes

Estas no son obvias al leer el código y están explicadas en el diagrama:

1. **Imágenes estáticas como data URI.** `background.js` convierte cada PNG a data URI antes de devolver el catálogo. Sin esto, `img.src` apuntando a `http://` dentro de una página `https://` es *mixed content* y el navegador lo bloquea.
2. **Lottie por JSON vía el service worker.** Los emojis animados no pueden cargarse como `<img>`; el content script pide el JSON con `FETCH_JSON` y lo renderiza con `lottie.loadAnimation` en el contenedor del mensaje.
3. **El refresh del access token vive en el cliente.** `api.js` intercepta un 401, llama `/auth/token/refresh/` y reintenta una vez. No hay blacklist de refresh tokens en el backend.
4. **El picker envuelve el input, no lo mueve de sitio.** lila localiza el input con
   `input.closest('.mchat')?.querySelector('input.mchat__say')` al enviar y al mencionar. La
   extensión lo envuelve en un `<div class="lce-input-wrapper">` dentro de `.mchat`, lo que
   preserva ese lookup. Hay un test e2e que lo verifica explícitamente.

## Limitación conocida

`setup()` marca `initialized = true` de forma permanente y `createPicker()` solo se llama ahí.
Si lila re-renderiza el input del chat (navegación SPA, cambio de pestaña, entrar a otra
partida), la extensión queda muerta en esa página: no hay Observer, no hay botón y no hay
camino de re-inicialización. Es el primer bug que conviene atacar.

## Estado del proyecto

**Inmaduro a propósito.** Issues abiertos en GitHub documentan lo que falta. Lo relevante antes de tocar otra cosa:

- Sin tests unitarios (los `tests.py` son boilerplate de `startapp`) y sin CI. El harness e2e
  existe pero su vía automatizada está bloqueada por la limitación de Playwright descrita arriba.
- `settings.py` tiene `SECRET_KEY` hardcodeada, `DEBUG = True` y `CORS_ALLOW_ALL_ORIGINS = True`
  ([#1](https://github.com/reinaldoviedo94/lichess-chat-enhanced/issues/1),
  [#2](https://github.com/reinaldoviedo94/lichess-chat-enhanced/issues/2),
  [#3](https://github.com/reinaldoviedo94/lichess-chat-enhanced/issues/3)).
- La adquisición de packs no implementa pagos
  ([#5](https://github.com/reinaldoviedo94/lichess-chat-enhanced/issues/5)).
- Sin despliegue: el backend solo corre en local, no hay imagen de contenedor ni pipeline.
- La extensión no se puede instalar de un clic: hay que cargarla descomprimida desde `dist/`.
  No hay página de descarga ni paquete firmado.

## Licencia

Sin licencia declarada. Añadir una antes de publicar el repo.
