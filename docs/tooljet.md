# ToolJet en este repo — runbook

> ⚠️ **ARCHIVADO (2026-09-27).** ToolJet quedó descartado: la instancia local corría una licencia
> inválida que bloqueaba `customThemesEnabled` (la feature del puente de tokens) y se abandonó la
> automatización vía MCP. Este documento se conserva como apunte del porqué y de lo que se probó;
> no refleja el estado activo. El trabajo de UX/UI sigue en la ruta nativa (ver README).

Runbook operativo del plano ToolJet (*era: prototipo, consola de packs, puente de tokens*).
La **spec** con las decisiones de diseño está en [`specs/ux-ui-tooljet.md`](specs/ux-ui-tooljet.md).
El diagrama del plano está en [`tooljet.html`](tooljet.html) (spec: [`tooljet.json`](tooljet.json)).

> **ToolJet no es runtime de la extensión.** Nada de lo que se haga en ToolJet se shippa dentro de
> la extensión; lo único que cruza el puente son **design tokens** y **datos de la API Django**.

---

## 1. Estado en esta máquina (2026-09-27, verificado contra el contenedor)

| Pieza | Estado | Dónde / detalle |
|---|---|---|
| Instancia ToolJet | ✅ levantada | contenedor `tooljet`, imagen `tooljet/try:ee-lts-latest`, **3.20.233-ee-lts**, en `http://localhost:8080` |
| ToolJet MCP clonado | ✅ | `~/tools/tooljet-mcp` (`bundle/index.js`, sin build), handshake OK contra la instancia local |
| Servidor registrado en pi | ✅ | `~/.pi/agent/mcp.json` → `mcpServers.tooljet`, apuntando a `http://localhost:8080` |
| Skill `tooljet-app-builder` | ✅ | `~/.pi/agent/skills/tooljet-app-builder` |
| Licencia | ⚠️ **inválida** | `Invalid License Key: Parse error` → ver §2 |
| Usuario admin | ❌ **falta** | la base está vacía (0 usuarios, 0 apps) → primer alta en la UI |
| PAT (`tj_pat_…`) | ❌ **falta** | depende del admin → `~/.config/lce/tooljet-pat` |

Sin PAT el servidor arranca y responde con un error explícito, no se rompe en silencio:

```
tooljet-mcp: TOOLJET_SESSION_TOKEN or TOOLJET_PAT is required. ...
```

Y con PAT inválido el handshake sí funciona pero la tool falla con el 401 real del servidor:

```
Error: ToolJet PAT session exchange failed (HTTP 401) — TOOLJET_PAT was rejected ...
Response: {"path":"/api/personal-access-tokens/session","message":"Invalid personal access token"}
```

### Anatomía de la instancia (medida, no supuesta)

- **Un solo contenedor**: NestJS (`node dist/src/main`) + Postgres 16 + PostgREST + Redis, con
  `supervisord`. **No hay nginx**: el propio Express sirve la SPA y su fallback, por eso una ruta
  inexistente devuelve HTML en lugar de 404 JSON — no lo tomes por un bug de la API.
- **La API es `/api` (v1) y `/api/v2` solo para rutas versionadas de app**
  (`/api/v2/apps/:id/versions/:versionId/...`, `/api/v2/group-permissions`). Ambas existen y
  responden 401 sin token, que es lo que hace el MCP. `GET /api/v2/apps` **no** existe: la
  colección se sirve en `/api/apps`.
- Volumen `tooljet_data` → `/var/lib/postgresql/16/main` (todo el estado vive ahí).
- `TOOLJET_SERVER_URL=http://localhost`: correcto solo mientras no se publique fuera. Si algún día
  se expone por tunnel/proxy hay que cambiarlo, porque afecta al exchange de sesión y a los links
  que genera la app.
- Ruido en los logs: `Failed opening the temp RDB file ... Permission denied`. Redis corre como
  `appuser` y no puede escribir en `/app`, así que **el estado de las colas no sobrevive a un
  reinicio del contenedor**. No bloquea el trabajo de diseño; sí significa que una app con workflows
  encolados pierdelos al reiniciar.

## 2. La licencia es el cuello de botella real

La instancia corre **sin licencia válida** (`isLicenseValid: false`). Los términos que reporta el
propio servidor:

| Permitido (límite) | Deshabilitado |
|---|---|
| 10 apps · 10 tablas · 500 filas | **`customThemesEnabled: false`** |
| 52 usuarios (2 editores, 50 viewers) | `customStylingEnabled: false` |
| 1 workspace | `multiEnvironmentEnabled: false` |
| workflows (2, 10 000/mes) | audit logs · OIDC · LDAP · SAML · app history · app JS libs |

**Impacto directo en la spec:** el puente de tokens (fase P3) se apoyaba en `manage_theme`, y
`manage_theme` está detrás de `customThemesEnabled`. Sin licencia, el MCP puede crear apps,
componentes y queries, pero **el tema `lce-whatsapp` no se puede crear** y el export a
`tokens.json` no ocurre.

Consecuencia de diseño, y no es un rodeo: **`tokens.json` se vuelve la fuente de verdad**, escrita a
mano en P0 y versionada en git. ToolJet la consume como referencia visual y, si algún día hay
licencia, la rec-genera. La spec no depende de una feature de pago para arrancar.

## 3. Puesta en marcha (5 minutos, una vez)

```bash
# 1. Crear el admin: abrir http://localhost:8080 y completar el alta del primer usuario.
#    (0 usuarios en la base: la instancia está en primer arranque.)

# 2. Crear el PAT en ToolJet → Profile Settings → Personal access tokens.
#    IMPORTANTE: créalo en el workspace que quieres que toque el agente.
#    La sesión de un PAT queda anclada a ese workspace y no alcanza ningún otro.
mkdir -p ~/.config/lce && chmod 700 ~/.config/lce
printf 'tj_pat_TU_TOKEN' > ~/.config/lce/tooljet-pat
chmod 600 ~/.config/lce/tooljet-pat

# 3. Verificar (desde una sesión de pi)
mcp({ connect: "tooljet" })   # tools/list y luego una tool de lectura
```

La URL ya está fija en la config (`http://localhost:8080`): no hay nada que exportar. Si algún día
se apunta a otra instancia, se cambia el valor en `~/.pi/agent/mcp.json`.

## 4. Cómo está registrado (y por qué así)

```json
"tooljet": {
  "command": "node",
  "args": ["/home/reinaldo/tools/tooljet-mcp/bundle/index.js"],
  "lifecycle": "lazy",
  "directTools": false,
  "env": {
    "TOOLJET_DEPLOYMENT_URL": "http://localhost:8080",
    "TOOLJET_PAT": "!cat /home/reinaldo/.config/lce/tooljet-pat 2>/dev/null || true"
  }
}
```

- `lifecycle: "lazy"` — el proceso Node no arranca hasta que se usa una tool.
- `directTools: false` — las **54 tools** (contadas en el build local) no se vuelcan al contexto de
  cada sesión; se acceden bajo demanda con `mcp({ tool: "create_app", args: {...} })`. La doc
  oficial dice 50: el bundle es más nuevo que la página. Para este repo, no volcarlas es lo correcto.
- `env` con valor que empieza por `!` — pi **ejecuta ese comando al conectar**. Así el PAT se lee
  de un archivo local ignorado por git en vez de vivir en texto plano en la config.

## 5. Las tools que importan para este proyecto

De las disponibles ([catálogo completo](https://docs.tooljet.com/docs/build-with-ai/mcp/supported-tools/)):

| Tool | Para qué aquí |
|---|---|
| `create_app` + `add_components` + `add_events` | construir el Design Lab y la consola de packs |
| `get_app_summary` | inspeccionar una app sin descargar la definición entera |
| `add_queries` / `run_query` | conectar la API Django (`127.0.0.1:8000`) desde ToolJet |
| `manage_theme` + `update_app_settings` | tema `lce-whatsapp` — **bloqueado sin licencia** (§2) |
| `lint_app_spec` → `apply_app_phase` | **siempre** en este orden: valida en seco antes de escribir |
| `validate_app` | chequeo estructural tras un cambio |
| `get_component_catalog` | lista de componentes y propiedades disponibles |

`delete_page`, `delete_query`, `delete_components`, `drop_table` y `drop_table_column` piden
confirmación explícita: **no las aceptes en un `apply_app_phase` ciego.**

## 6. Los tres roles, y qué se entrega en cada uno

1. **Design Lab** — prototipo del panel con estética WhatsApp sobre el catálogo real. Entregable:
   decisiones de layout y espaciado. No genera código de la extensión.
2. **Consola de packs** — app contra la API Django para activar/editar/precios/assets. Los datos
   viven en Django; ToolJet **no** guarda copia (ToolJet DB queda fuera por diseño).
3. **Puente de tokens** — *dirección invertida respecto a lo que suponía la spec*: con la licencia
   inválida, `tokens.json` se escribe a mano en P0 y es la fuente de verdad; el tema de ToolJet
   pasa a ser su reflejo cuando haya licencia. El generador `tokens-to-css.mjs` no cambia.

## 7. Límites conocidos antes de empezar

- **Sin licencia no hay temas** (ver §2). Es el límite que decide el orden de las fases.
- **Embed es plan Team.** La idea de meter una app ToolJet dentro de la extensión con `iframe` está
  descartada (ver spec §2).
- **`tooljet-cli` no sirve aquí:** `@tooljet/cli` gestiona *plugins de marketplace*, no apps.
- **El MCP solo actúa sobre el entorno de desarrollo.** Apuntarlo a una instancia cuyo
  "development" sea la base de producción no da aislamiento real.
- **Los tokens del tema son hex literales**, no referencias a variables CSS: ToolJet genera sus
  `--cc-*` en runtime. El export a `tokens.json` es manual o por MCP, no automático.
- **Sin tests automatizados para la extensión**: la vía e2e con Playwright sigue bloqueada (ver
  README). La validación visual del panel es manual hoy; el harness `e2e/harness/index.html` es la
  vía de verdad.

## 8. Actualizar

```bash
git -C ~/tools/tooljet-mcp pull --ff-only
rm -rf ~/.pi/agent/skills/tooljet-app-builder
cp -r ~/tools/tooljet-mcp/skills/tooljet-app-builder ~/.pi/agent/skills/
/reload
```

El SKILL.md es un archivo **generado** (`scripts/generate-skill.mjs` en el repo del MCP): no lo
edites a mano, cópialo de nuevo.
