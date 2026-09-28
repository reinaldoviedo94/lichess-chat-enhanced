# Spec — UX/UI del picker con lenguaje shadcn + estética WhatsApp, y el plano ToolJet

> **Estado:** propuesta para revisión. Nada de lo que hay aquí está implementado todavía.
> **Fecha:** 2026-09-27
> **Ámbito:** `clients/extensions/chrome/lichess-chat-enhanced/` (UI) + un nuevo plano de trabajo en
> ToolJet (prototipo, consola de packs y puente de design tokens).
> **Diagramas:** [`../tooljet.html`](../tooljet.html) (plano ToolJet) y
> [`../architecture.html`](../architecture.html) (runtime actual, canónico).

---

## 1. Objetivo

Mejorar la UX/UI de la extensión sin reescribir su base:

1. El **menú/picker** de emojis deja de ser un `<div>` gris con secciones sueltas y pasa a ser un panel con
   la gramática visual de shadcn (tokens semánticos, radios consistentes, foco visible, estados de
   interacción) y una **apariencia inspirada en el selector de adjuntos de WhatsApp** (panel
   emergido, pestañas de packs, rejilla de stickers, burbuja de previsualización).
2. **ToolJet entra como plano de diseño y de operación**, no como runtime de la extensión:
   - *Design Lab*: prototipo navegable del panel para iterar el look sin tocar el bundle.
   - *Consola de packs*: administración real de packs/precios/moderación contra la API Django.
   - *Puente de tokens*: el tema es un artefacto versionado, y el CSS de la extensión lo consume.
3. Todo el trabajo queda **automatizado para pi**: servidor MCP de ToolJet registrado, skill de
   app-builder instalada y un diagrama Archify que documenta el flujo.

## 2. Decisión de arquitectura (leída antes que nada)

**ToolJet no se embebe en la extensión.** El picker vive en un *content script* de MV3 inyectado en
`lichess.org`, y tiene que cumplir restricciones que ToolJet no puede cumplir:

| Restricción real | Por qué | Veredicto |
|---|---|---|
| `webpack.config.js` fija `splitChunks: false` "CSP blocks dynamic chunks on Lichess" | No hay `unsafe-eval` ni chunks dinámicos; nada de runtime que se resuelva en caliente | Un bundle de ToolJet (React + editor) no cabe aquí |
| El picker se inyecta en el DOM de lila y debe seguir `input.closest('.mchat')?.querySelector('input.mchat__say')` | Contrato de lila, hay test e2e que lo verifica | Un `<iframe>` externo rompe el modelo de input y el foco |
| El catálogo ya está **resuelto offline**: `background.js` convierte PNG a data URI y sirve Lottie por `FETCH_JSON` | Mixed content y CORS en `https://` | Un panel que dependa de red en cada apertura es una regresión |
| La Web Store revisa extensiones que cargan UI remota | Política de MV3 | Riesgo de rechazo en la revisión |
| Latencia percibida al abrir el panel | Se abre con cada clic en la barra | Un iframe remoto añade 300 ms+ mínimo |

**Lo que sí es cierto y se aprovecha:** ToolJet es excelente como *fuera* del runtime — prototipado
visual rápido, consola operativa sobre la API, y generador de tokens.

```
Runtime (se shippa)          Diseño (no se shippa)        Operación (no se shippa)
─────────────────────         ─────────────────────        ───────────────────────
content.js + content.css  ◄──  Design Lab (ToolJet app)  ──►  Consola de packs
popup.js + popup.css          theme → tokens.json              (ToolJet app)
                              puente de tokens
```

## 3. Roles de ToolJet

### 3.1 Design Lab (prototipo visual)

Una app ToolJet de una sola página, `LCE Design Lab`, cuyo propósito es **iterar el panel del picker
sin compilar la extensión**.

- **Datasources:** `REST API` → `http://127.0.0.1:8000/api` (packs y catálogo), misma URL que usa la
  extensión, con la misma autenticación (`Authorization: Bearer`) documentada en la app.
- **Componentes:** `Container` raíz con el tema aplicado, `Tabs` para packs, `Listview` o `Table`
  para la rejilla, `TextInput` para el buscador, `Popover-menu` para el menú de pack, `Modal-v2` para
  la vista de detalle.
- **Qué replica:** el panel de stickers de WhatsApp — cabecera con búsqueda y pestañas, rejilla de
  8 columnas, tile de 48 px, tile "pausado" para los animados (mismo motivo que hoy: el Lottie no se
  puede pintar como `<img>`), y una **burbuja de previsualización** al hacer hover/focus con el slug
  `:smile:` que se insertaría.
- **Qué exporta:** el panel no exporta código. Exporta **tokens** (§5) a través de un botón
  *Copy tokens → JSON* alimentado por el `theme` activo de la app.
- **Interacción con el agente:** vía MCP (§6), el agente puede reconstruir el panel, cambiar
  densidades y tema, y devolver la app lista para editar.

### 3.2 Consola de packs (operación)

App ToolJet contra la API Django/DRF existente. Cierra el issue #5 (adquisición sin pagos) en su
parte operativa y quita el `Django admin` como única herramienta.

- **Listado de packs:** tabla con `slug`, nombre, `precio`, `gratis`, `activo`, nº de emojis, created.
- **Acciones:** activar/desactivar, editar nombre/precio, subir assets (multipart a `MEDIA_ROOT`),
  previsualizar el JSON de un pack, marcar un slug reservado.
- **Workflow ToolJet** (opcional, fase P3): gatillo *programado* que revisa packs sin assets o con
  slug duplicado y deja una fila en una tabla de incidencias, en vez de fallar en silencio.
- **Restricción dura:** el ToolJet DB **no** es la fuente de verdad. Los datos viven en Django +
  SQLite/Postgres; ToolJet entra por REST. Si se duplica el modelo de datos, la divergencia es
  garantizada.

### 3.3 Puente de design tokens

El tema deja de ser "lo que alguien escribió en `content.css`" y pasa a ser un artefacto con nombre,
revisión y validación.

> **Inversión de dirección, decidida al revisar la instancia local (ver `docs/tooljet.md` §2):**
> la licencia de esta instancia es inválida y por tanto `customThemesEnabled: false` — que es
> justamente la puerta detrás de `manage_theme`. Así que la flecha va al revés de lo que se
> suponía: **`tokens.json` se escribe a mano en P0 y es la fuente de verdad; ToolJet lo consume
> como referencia visual y, cuando haya licencia, lo regenera.** Ninguna fase depende de una
> feature de pago.

```
docs/design/tokens.json          ← canónico, en git, revisado en PR
        │  (script scripts/tokens-to-css.mjs)
        ▼
src/content/tokens.css           ← generado, no editar a mano
src/popup/tokens.css

        ▲  (solo con licencia: export inverso por MCP)
        │
ToolJet workspace theme  ──manage_theme──►  theme "lce-whatsapp" (brand/text/border/surface)
        │
        └─► get_app_summary → theme → se contrasta contra tokens.json en el PR
```

Por qué encaja: la definición de tema de ToolJet ya tiene **exactamente** la forma que shadcn
usa — `brand / text / border / surface / systemStatus` con variantes `light` y `dark`, y radios
`default / small / large`. El mapeo es 1:1 y no necesita traducción semántica.

## 4. Especificación de UI (lo que entra en la extensión)

### 4.1 Restricciones que la UI debe respetar

1. El input se **envuelve**, no se mueve: `div.lce-input-wrapper` dentro de `.mchat`, preservando
   el lookup de lila (contrato con test e2e existente).
2. Todo el DOM del panel se crea con `createElement` + `textContent`. **Nada de `innerHTML` con
   datos del catálogo**: hoy `renderPicker()` borra y reconstruye, y es el punto donde un nombre de
   pack con `<` se convertiría en HTML.
3. Se **no** inyecta `<style>` en el DOM de la página: el CSS viaja como `content.css` del content
   script (declarado en `manifest.json`). Tokens dinámicos se escriben con
   `element.style.setProperty('--lce-...', valor)`, que la CSP de lila no bloquea.
4. Aislamiento: la UI vive en el light DOM de `.mchat` (lila lo estiliza), así que **cada clase
   `.lce-*` debe ser autosuficiente** y no puede depender de cascadas externas.

### 4.2 Anatomía del panel

```
┌─ .lce-panel (380×420, radio 16, sombra larga, anclado al input) ─────────┐
│ ┌─ .lce-panel-header ─────────────────────────────────────────────────┐ │
│ │ 🔍 [ Buscar emoji o :slug:…            ]                    ✕      │ │  ← shadcn Input
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌─ .lce-panel-tabs (scroll horizontal, indicator activo) ─────────────┐ │
│ │ [🙂 Smileys] [😀 chess-plus] [＋ Tienda]                             │ │  ← shadcn Tabs
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌─ .lce-panel-body (grid 8 col, gap 4, tile 40px) ───────────────────┐ │
│ │  ▢  ▢  ▢  ▢  ▢  ▢  ▢  ▢                                             │ │
│ │  ▢  ▢  ▶  ▢  ▢  ▢  ▢  ▢   ← ▶ = tile "pausado" (Lottie)            │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌─ .lce-panel-footer ─────────────────────────────────────────────────┐ │
│ │ Enter inserta · Esc cierra · ⇧Tab recorre                            │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

Elementos (equivalentes shadcn, portados a CSS + JS vanilla, sin dependencia):

| Elemento shadcn | Qué se porta | Nota de implementación |
|---|---|---|
| `Popover` | `.lce-panel` | `position: absolute; bottom: 100%; right: 0` + `data-state="open\|closed"` en vez de `style.display` |
| `Input` | `.lce-panel-search` | `role="combobox"`, `aria-expanded`, `aria-controls` |
| `Tabs` / `TabsList` / `TabsTrigger` | `.lce-panel-tabs*` | `role="tablist"`, flechas ←/→, `aria-selected` |
| `Tooltip` | `.lce-panel-bubble` | aparece con hover **y** con focus, 400 ms de delay |
| `Badge` | `.lce-pack-badge` | "GRATIS" / precio, con contraste AA |
| `Skeleton` | `.lce-tile-skeleton` | mientras llega el catálogo |
| `ScrollArea` | `overflow-y: auto` nativo | nada de scrollbar custom en la v1 |

### 4.3 Interacciones

- **Apertura:** clic en el botón, o `Ctrl/Cmd+E` sobre el input. Se conserva el foco en el input
  (el panel no roba el foco) — es lo que espera lila.
- **Búsqueda:** filtra por `slug` y por `pack`, con *debounce* de 120 ms sobre `emojiMap` ya
  cargado (todo en memoria, sin red).
- **Inserción:** clic o `Enter` sobre el tile activo inserta `:slug:`, dispara `input` con
  `bubbles: true` y deja el panel abierto si `Shift` está pulsado.
- **Cierre:** `Esc`, clic fuera, o `blur` del input. Un solo listener en `document`, registrado una
  vez (hoy `createPicker()` añade un listener nuevo cada vez que se llama — fuga real).
- **Tile animado:** al *hover*, precargar el JSON Lottie por `FETCH_JSON` con un debounce de 200 ms;
  al seleccionar, renderizar en la burbuja en vez de en la rejilla.
- **Tienda:** la pestaña "Tienda" lleva al popup (o a la URL del pack si no hay sesión). No se
  implementa compra aquí — el issue #5 sigue abierto.

### 4.4 Accesibilidad (WCAG 2.2 AA)

- Contraste ≥ 4.5:1 en texto de tile, slug en tooltip, y precio vs. fondo del badge.
- Foco visible en todo el panel (anillo de 2 px con offset, no `outline: none`).
- `prefers-reduced-motion: reduce` → el tile animado no autoplay en hover; Lottie en el mensaje sigue
  animándose (lo decide lila, no la extensión) pero el hover muestra la imagen estática.
- Todo control alcanzable por teclado, con un solo `tabindex` por tile (`roving tabindex`).
- El panel es `role="dialog"` con `aria-label="Emojis y stickers"`, no un `div` suelto.

### 4.5 Corrección obligatoria asociada (bug conocido)

`setup()` marca `initialized = true` para siempre y `createPicker()` solo se llama ahí. Si lila
re-renderiza el chat (SPA, cambio de pestaña, otra partida) la extensión queda muerta: sin botón y
sin camino de re-inicialización. **Cualquier rediseño del panel tiene que cerrar esto**, porque un
diseño bonito que desaparece en la segunda partida es peor que el actual.

Enfoque: `MutationObserver` sobre `.mchat` que detecta un `input.mchat__say` nuevo, desmonta el
panel anterior (`destroyPicker()`) y vuelve a montar. El estado `initialized` pasa a ser
"montado este nodo de input", no "esta página".

## 5. Contrato de design tokens

`docs/design/tokens.json` es canónico. `scripts/tokens-to-css.mjs` lo convierte en
`src/content/tokens.css` y `src/popup/tokens.css`.

Esquema (alineado con la definición de tema de ToolJet y con la de shadcn):

```jsonc
{
  "name": "lce-whatsapp",
  "brand":   { "primary": { "light": "#00A884", "dark": "#00A884" },
               "secondary": { "light": "#008069", "dark": "#111B21" } },
  "surface": { "appBackground": { "light": "#ECE5DD", "dark": "#0B141A" },
               "surface1":      { "light": "#FFFFFF", "dark": "#202C33" },
               "surface2":      { "light": "#F0F2F5", "dark": "#2A3942" },
               "surface3":      { "light": "#E9EDEF", "dark": "#111B21" } },
  "text":    { "font": "system-ui",
               "colors": { "primary":     { "light": "#111B21", "dark": "#E9EDEF" },
                           "placeholder":{ "light": "#667781", "dark": "#8696A0" },
                           "onPrimary":   { "light": "#FFFFFF", "dark": "#111B21" } } },
  "border":  { "radius": { "default": "8px", "small": "4px", "large": "16px" },
               "colors": { "default": { "light": "#D1D7DB", "dark": "#222D34" },
                           "weak":    { "light": "#E9EDEF", "dark": "#1F2C33" } } },
  "systemStatus": { "colors": { "success": { "light": "#00A884", "dark": "#00A884" },
                                "error":   { "light": "#D93025", "dark": "#F15C6D" },
                                "warning": { "light": "#B78100", "dark": "#E0A82E" } } }
}
```

Mapeo a CSS (una sola fuente, sin literales sueltos en las hojas de estilo):

| Token JSON | Variable CSS | Uso |
|---|---|---|
| `brand.primary` | `--lce-brand` | botón del emoji, tile activo, indicator de tab |
| `surface.surface1` | `--lce-surface-1` | fondo del panel, tile |
| `text.colors.primary` | `--lce-text` | slug, etiquetas |
| `border.radius.large` | `--lce-radius-panel` | panel |
| `border.radius.default` | `--lce-radius-tile` | tile, input, botón |
| `systemStatus.colors.error` | `--lce-danger` | estado de error al cargar el catálogo |

**Regla dura:** después de esta fase, `content.css` y `popup.css` no contienen literales hex ni
pixels sueltos. Toda constante pasa a token o a custom property con nombre.

**Tema del sitio:** la extensión vive dentro de lila, que tiene tema claro y oscuro propio. El panel
detecta el tema del sitio (lila usa `body.dark`/atributo equivalente) y conmuta
`data-lce-theme="dark"`, que redefine el bloque `[data-lce-theme="dark"]`. El panel nunca fuerza un
tema; si el sitio es claro, el panel es claro.

## 6. Automatización de ToolJet (investigación + instalación)

### 6.1 Lo que existe hoy (verificado el 2026-09-27)

| Hecho | Fuente |
|---|---|
| **ToolJet MCP server existe**, con **50 herramientas**, maintained por ToolJet | `https://github.com/ToolJet/tooljet-mcp` (`package.json` v0.6.0, `engines.node >= 20`) |
| Bundle commiteado: se registra `node bundle/index.js` por stdio, **sin paso de build** | `mcp.json` del repo |
| Config: `TOOLJET_DEPLOYMENT_URL` (default `http://localhost:3000`) y `TOOLJET_PAT` (`tj_pat_…`); opcional `TOOLJET_URL` si API y UI están en orígenes distintos | docs `build-with-ai/mcp/setup` |
| El PAT está **anclado al workspace** donde se creó y solo ve ese workspace | docs `mcp/setup` + `security` |
| MCP funciona solo en el **entorno de desarrollo**; staging/producción quedan fuera | docs `mcp/security` |
| Se instala junto a un **skill** `tooljet-app-builder` (con `references/` y `scripts/browser-audit.js`) — las tools sin el skill dejan al adivinar el modelo de app | docs `mcp/setup` |
| Las 5 tools destructivas (`delete_page`, `delete_query`, `delete_components`, `drop_table`, `drop_table_column`) exigen confirmación explícita | docs `mcp/supported-tools` |
| `manage_theme` gestiona temas de workspace; hay que aplicar el tema con `update_app_settings` y el tema **no** se aplica solo al crearlo. **Además está detrás de `customThemesEnabled`, que en esta instancia está en `false`.** | `docs/theme-api-tool.md` en el repo del MCP + `docs/tooljet.md` §2 |
| El MCP corre local y solo habla con tu instancia; telemetría solo si pones `TOOLJET_TELEMETRY_PATH` | docs `mcp/security` |
| Embed de apps ToolJet existe (público y privado, con SSO del host) pero es **plan Team** y no aplica aquí | docs `app-builder/embed-app/overview` |
| `tooljet-cli` (`@tooljet/cli`) es para **plugins de marketplace**, no para gestionar apps | docs `tooljet-cli` |
| ToolJet Custom Component SDK (`@tooljet/custom-component-sdk`) permite componentes React propios | registro npm |

### 6.2 Cómo queda registrado en pi

pi ya tiene un servidor MCP stdio con el mismo modelo (`command`/`args`/`env` en
`~/.pi/agent/mcp.json`), así que el ToolJet MCP entra sin adaptadores. Instalado en
`~/.pi/agent/mcp.json`:

```json
"tooljet": {
  "command": "node",
  "args": ["$HOME/tools/tooljet-mcp/bundle/index.js"],
  "lifecycle": "lazy",
  "directTools": false,
  "env": {
    "TOOLJET_DEPLOYMENT_URL": "${TOOLJET_DEPLOYMENT_URL}",
    "TOOLJET_PAT": "!cat $HOME/.config/lce/tooljet-pat"
  }
}
```

Dos detalles que importan:

- `"env"` admite un valor que **empieza por `!`**, que se ejecuta como comando al conectar. Eso
  permite leer el PAT de un archivo local ignorado por git en vez de dejarlo en texto plano en la
  config.
- `"directTools": false` deja las tools detrás del gateway MCP (`mcp({ tool: ... })`) en vez de
  volcar 50 herramientas al contexto de cada sesión. Para este repo es la decisión correcta: las
  tools se usan de forma ordenada, por lotes, cuando la tarea lo pide.

Estado real en esta máquina: el repositorio está clonado, el servidor está registrado y el skill
está instalado. **Falta únicamente el PAT y la URL de la instancia** (§6.4).

### 6.3 Capas de automatización, de la más barata a la más cara

1. **Skill de pi** (`~/.pi/agent/skills/tooljet-app-builder`): instrucciones de dominio para el
   agente. Coste cero, siempre disponible.
2. **MCP**: las tools del bundle (54 en el build local, 50 en la doc) para crear y modificar apps de verdad, con `lint_app_spec` antes de
   `apply_app_phase`. Es la capa que permite "cambia el panel a 6 columnas y oscurece la cabecera"
   sin abrir el editor a mano.
3. **GitSync**: el JSON de la app en el repo, con push/pull. Hace la app revisable en PR y
   auditable; es lo que evita que la app del Design Lab se vuelva un hub huérfano.
4. **ToolJet API + PAT** (scripts, CI): exportar/importar versiones de app
   (`/api/v2/apps/...`, GitSync API) para pipelines.
5. **ToolJet workflows**: solo para automatizaciones que cruzan apps (moderación programada,
   reporte). No para lógica de la extensión.

### 6.4 Qué falta para que funcione (accionable, 5 minutos)

```bash
# 1. Instancia: ToolJet Cloud o self-hosted.
mkdir -p ~/.config/lce
printf 'tj_pat_TU_TOKEN' > ~/.config/lce/tooljet-pat   #Profile Settings → Personal access tokens
chmod 600 ~/.config/lce/tooljet-pat

# 2. Exportar la URL antes de lanzar pi
export TOOLJET_DEPLOYMENT_URL="https://tu-instancia.tooljet.cloud"

# 3. Verificar
mcp({ connect: "tooljet" })   # debe confirmar workspace
```

Reglas de seguridad que no se negocian (vienen de la doc de ToolJet y son correctas):

- El PAT se crea **en el workspace que quieres que toque el agente**, no en uno con más acceso.
- **Nunca** en un archivo versionado; por eso va a `~/.config/lce/tooljet-pat`.
- Solo `https://` en la URL de la instancia: el PAT viaja en cada llamada.
- El MCP solo actúa sobre el **entorno de desarrollo**. Nunca apuntarlo a la instancia que apunta a
  datos de producción.

## 7. Fases

| Fase | Entregable | Depende de |
|---|---|---|
| **P0 — tokens** | `docs/design/tokens.json` + `scripts/tokens-to-css.mjs` + `tokens.css` generado; `content.css`/`popup.css` sin literales | — |
| **P1 — re-init** | `destroyPicker()` + `MutationObserver` sobre `.mchat`; el panel sobrevive al re-render de lila | P0 |
| **P2 — panel** | Anatomía §4.2 completa, teclado, a11y, `data-lce-theme` | P0, P1 |
| **P3 — Design Lab** | App ToolJet del prototipo. El tema `lce-whatsapp` **queda condicionado a licencia**; sin licencia la app usa el tema por defecto y los tokens salen de `tokens.json` | P0 |
| **P4 — Consola** | App ToolJet de packs contra la API Django | P3 |
| **P5 — GitSync + CI** | App JSON en el repo, export en pipeline, revisión de tokens en PR | P3 (o P1 si P3 se salta por licencia) |

P0–P2 no dependen de ToolJet en absoluto. **Ese es el punto:** si ToolJet nunca se levanta, la
mejora de UX/UI igual se entrega.

## 8. Criterios de aceptación

**UI (P2)**

1. El panel abre y cierra con teclado (`Ctrl/Cmd+E`, `Esc`) y con ratón, sin perder el foco del
   input de lila.
2. Recorrer 8 columnas con flechas, `Enter` inserta `:slug:`, y el texto aparece en el input con un
   único evento `input` con `bubbles: true` (igual que hoy).
3. El catálogo se renderiza sin `innerHTML` con datos externos: un pack llamado `<img onerror>`
   aparece como texto, no como elemento.
4. Cambiar de partida SPA o de pestaña mantiene el panel vivo (bug del §4.5 cerrado, con test).
5. axe en el panel: 0 violaciones serias; contraste AA verificado en claro y oscuro.
6. `content.css` y `popup.css` sin literales hex; todo el color pasa por `--lce-*`.
7. Ninguna ruta nueva de red al abrir el panel: los PNG siguen viniendo como data URI y los Lottie
   por `FETCH_JSON`.

**ToolJet (P3–P5)**

8. `mcp({ connect: "tooljet" })` confirma workspace y lista tools disponibles.
9. El agente puede crear la app del Design Lab y modificarla (añadir componente, cambiar layout)
   con `lint_app_spec` en verde antes de `apply_app_phase`.
10. `manage_theme` crea `lce-whatsapp` y `update_app_settings` lo aplica; el export produce un
    `tokens.json` equivalente al del contrato, con la misma clave por clave.
    **Condicionado a licencia:** con `customThemesEnabled: false` este criterio no se cumple y el
    Design Lab funciona con el tema por defecto, usando `tokens.json` como referencia.
11. La consola lista packs contra `127.0.0.1:8000` y puede activar/desactivar uno.
12. Un push de GitSync deja el JSON de la app en el repo y una revisión lo aprueba antes de publicar.

## 9. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| ToolJet se convierte en el sitio donde vive la UI y no en su prototipo | Alto: la extensión queda atada a una plataforma y a un plan (embed es **Team**) | El Design Lab no genera código de la extensión; P0–P2 son vanilla |
| CSP de lila rompe el `<style>` inyectado | Medio | Todo el CSS vía `content.css`; tokens dinámicos con `setProperty` |
| Ruido de `document.addEventListener` accumulating en cada montaje | Medio | `destroyPicker()` con `removeEventListener`; test que cuenta listeners |
| El PAT se filtra a git o a una transcripción de chat | Alto | Archivo `~/.config/lce/tooljet-pat` con `chmod 600`, nunca en el repo ni en un prompt |
| Divergencia de datos entre ToolJet DB y Django | Alto | ToolJet solo consume REST; nunca se escribe en ToolJet DB desde la extensión |
| La tabla de catálogo crece y el `TreeWalker` se degrada | Medio | Hoy se transforma en cada mutación con debounce de 100 ms; medir antes de P2 y, si falla, cachear por nodo ya procesado |
| El skill/MCP se actualiza y rompe el build de la extensión | Bajo | La extensión no depende del MCP; el repo clonado se actualiza a mano y con revisión |

## 10. Fuera de alcance (decidido, no olvidado)

- **No** se embebe ToolJet en la extensión.
- **No** se migra a React/Tailwind/shadcn real. shadcn aquí es un **lenguaje** (tokens, radios,
  estados), portado a CSS; el bundle sigue siendo vanilla y no crece.
- **No** se implementa el flujo de pago de packs (issue #5) en este trabajo; la pestaña "Tienda"
  navega, no cobra.
- **No** se toca `SECRET_KEY`/`DEBUG`/`CORS` (issues #1–#3); es deuda de seguridad, no de UX.

## 11. Referencias

- ToolJet MCP: <https://github.com/ToolJet/tooljet-mcp> ·
  [Setup](https://docs.tooljet.com/docs/build-with-ai/mcp/setup/) ·
  [Supported Tools](https://docs.tooljet.com/docs/build-with-ai/mcp/supported-tools/) ·
  [Security](https://docs.tooljet.com/docs/build-with-ai/mcp/security/)
- Tema por API: `docs/theme-api-tool.md` en el repo del MCP (`manage_theme`).
- GitSync: <https://docs.tooljet.com/docs/development-lifecycle/gitsync/overview/>
- ToolJet API (PAT, export/import de apps): <https://docs.tooljet.com/api/tooljet-api/>
- shadcn/ui (tokens y primitivas como referencia):
  <https://ui.shadcn.com/docs/theming> · <https://ui.shadcn.com/docs/components>
- Archivos del repo que este spec toca:
  `clients/extensions/chrome/lichess-chat-enhanced/src/content/{content.js,content.css}`,
  `src/popup/{popup.js,popup.css,popup.html}`, `manifest.json`, `webpack.config.js`.
