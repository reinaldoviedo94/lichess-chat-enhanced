#!/usr/bin/env node
// Automated smoke test of the built extension against the lila-shaped harness.
//
//   pnpm build            # the extension must be built first
//   node e2e/run.mjs
//
// It stages a copy of dist/ with the harness origin added to the manifest, serves
// the harness, loads the extension into two isolated Chrome profiles (A and B),
// and asserts the real behaviour: catalogue load, data-URI conversion, Lottie
// rendering, DOM replacement, picker, MutationObserver, idempotence, and the
// login/popup flow.
//
// KNOWN LIMITATION: Playwright's launch sequence does not expose the MV3 service
// worker of an unpacked extension reliably (it starts before Playwright attaches,
// and Chrome ignores --load-extension under some Playwright default arg sets).
// When the worker cannot be found the script says so and points at the manual
// procedure in e2e/README.md instead of pretending the checks passed.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(HERE, '..', 'dist');
const HARNESS = join(HERE, 'harness');
const HARNESS_PORT = 8849;

// Playwright is not a dependency of this package: it is a global harness tool.
// Resolve it from wherever it happens to live, or let the user point at it.
const PLAYWRIGHT_PATHS = [
  process.env.PLAYWRIGHT_PATH,
  '/home/reinaldo/.nvm/versions/node/v24.16.0/lib/node_modules/@playwright/mcp',
  '/usr/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright',
].filter(Boolean);

function loadPlaywright() {
  for (const base of PLAYWRIGHT_PATHS) {
    try {
      return createRequire(join(base, 'package.json'))('playwright');
    } catch {
      /* try the next candidate */
    }
  }
  console.error(
    'No encontré playwright. Instálalo (npm i -g playwright) o define PLAYWRIGHT_PATH con la ruta del paquete.',
  );
  process.exit(2);
}

const results = [];
const record = (side, name, pass, detail = '') => {
  results.push({ side, name, pass, detail });
  console.log(`[${side}] ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function serve(dir, port) {
  const server = createServer(async (req, res) => {
    const name = (req.url ?? '/').split('?')[0];
    const file = join(dir, name === '/' ? 'index.html' : name);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

/** Copy dist/ and add the harness origin so the real content script can be exercised. */
async function stageExtension() {
  if (!existsSync(join(EXT_DIST, 'manifest.json'))) {
    console.error(`Falta ${join(EXT_DIST, 'manifest.json')} — corre \`pnpm build\` primero.`);
    process.exit(2);
  }
  const dir = await mkdtemp(join(tmpdir(), 'lce-dist-'));
  await cp(EXT_DIST, dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const origin = `http://127.0.0.1:${HARNESS_PORT}/*`;
  manifest.content_scripts[0].matches.push(origin);
  manifest.web_accessible_resources[0].matches.push(origin);
  if (!manifest.host_permissions.includes(origin)) manifest.host_permissions.push(origin);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

/** Chrome derives unpacked extension ids from the absolute path, but the mapping
 *  is not the naive a-p byte map, so read the id from CDP instead of guessing. */
async function findExtensionId(cdp, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const worker = targetInfos.find(
      (t) => t.type === 'service_worker' && /^[a-p]{32}$/.test(t.url.split('/')[2] ?? ''),
    );
    if (worker) return worker.url.split('/')[2];
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function boot(chromium, side, extDir) {
  const profile = await mkdtemp(join(tmpdir(), `lce-profile-${side}-`));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  const extensionId = await findExtensionId(cdp);
  if (!extensionId) {
    await context.close();
    return { context: null, page: null, extensionId: null, profile };
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`http://127.0.0.1:${HARNESS_PORT}/index.html`, { waitUntil: 'load' });
  return { context, page, extensionId, profile, errors };
}

async function checkCatalogue(side, page) {
  const data = await page.evaluate(
    () => new Promise((res) => chrome.runtime.sendMessage({ type: 'GET_EMOJI_CATALOG' }, (r) => res(r ?? null))),
  );
  const free = data?.freePacks ?? [];
  const flat = free.flatMap((p) => p.emojis ?? []);
  record(side, 'catálogo carga packs', free.length > 0, `freePacks=${free.length}`);
  record(
    side,
    'slugs esperados',
    ['smile', 'cool', 'bounce'].every((s) => flat.some((e) => e.slug === s)),
    flat.map((e) => e.slug).join(','),
  );
  const statics = flat.filter((e) => e.emoji_type === 'static');
  record(
    side,
    'estáticos convertidos a data URI',
    statics.length > 0 && statics.every((e) => String(e.image).startsWith('data:image/')),
    `${statics.length} estáticos`,
  );
  const animated = flat.filter((e) => e.emoji_type === 'animated');
  record(
    side,
    'animados quedan como URL (van por FETCH_JSON)',
    animated.length > 0 && !String(animated[0].image).startsWith('data:'),
    animated.map((e) => e.image).join(' '),
  );
}

async function checkInitialTransform(side, page) {
  const s = await page.evaluate(() => {
    const emojis = [...document.querySelectorAll('.mchat__content .lce-emoji')];
    return {
      total: emojis.length,
      srcs: emojis.filter((e) => e.querySelector('img')).map((e) => e.querySelector('img').src.slice(0, 22)),
      lottie: document.querySelectorAll('.mchat__content .lce-emoji-animated svg').length,
      unknown: [...document.querySelectorAll('.mchat__content .text')].filter((e) =>
        e.textContent.includes(':nope_unknown:'),
      ).length,
      processed: document.querySelectorAll('[data-lce-processed]').length,
    };
  });
  record(side, 'reemplaza :slug: en mensajes existentes', s.total >= 3, `encontrados=${s.total}`);
  record(side, 'img usa data URI', s.srcs.length > 0 && s.srcs.every((x) => x.startsWith('data:image/')), s.srcs.join(' | '));
  record(side, 'Lottie renderiza SVG', s.lottie > 0, `svg=${s.lottie}`);
  record(side, 'slug desconocido queda como texto', s.unknown === 1, `encontrados=${s.unknown}`);
  record(side, 'marca nodos procesados', s.processed === s.total, `procesados=${s.processed}`);
}

async function checkPicker(side, page) {
  const btn = await page.$('.lce-emoji-btn');
  record(side, 'botón del picker insertado', !!btn);
  if (!btn) return;
  await btn.click();
  await page.waitForSelector('.lce-picker .lce-picker-item', { timeout: 5000 }).catch(() => {});
  const picker = await page.evaluate(() => ({
    items: document.querySelectorAll('.lce-picker-item').length,
    sections: [...document.querySelectorAll('.lce-picker-title')].map((e) => e.textContent),
  }));
  record(side, 'picker abierto con items', picker.items > 0, `items=${picker.items} secciones=${picker.sections.join('|')}`);
  await page.click('.lce-picker-item');
  const value = await page.inputValue('.mchat__say');
  record(side, 'insertar emoji escribe :slug: en el input', /^:[a-z0-9_-]+:$/.test(value), `valor="${value}"`);
  // lila finds the input via closest('.mchat').querySelector('input.mchat__say');
  // the picker moves that input inside a new wrapper, so this must still hold.
  const reachable = await page.evaluate(() => {
    const i = document.querySelector('.mchat__say');
    return { closest: !!i?.closest('.mchat'), query: !!i?.closest('.mchat')?.querySelector('input.mchat__say') };
  });
  record(side, 'lila sigue pudiendo encontrar el input', reachable.closest && reachable.query, JSON.stringify(reachable));
}

async function checkLiveMessage(side, page) {
  await page.evaluate(() => window.__receive('llegó :rocket: sin buscar'));
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({
    last: [...document.querySelectorAll('.mchat__content .lce-emoji')].at(-1)?.title ?? null,
    toast: document.querySelectorAll('.lce-toast').length,
  }));
  record(side, 'MutationObserver transforma mensaje nuevo', r.last === ':rocket:', `title=${r.last}`);
  record(side, 'muestra toast de reacción', r.toast > 0, `toasts=${r.toast}`);
}

async function checkIdempotence(side, page) {
  const before = await page.evaluate(() => document.querySelectorAll('.mchat__content .lce-emoji').length);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' }));
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => document.querySelectorAll('.mchat__content .lce-emoji').length);
  record(side, 'no duplica al recargar', before === after, `antes=${before} después=${after}`);
}

async function checkPopup(side, first) {
  const popup = await first.context.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(String(e)));
  await popup.goto(`chrome-extension://${first.extensionId}/popup/popup.html`);
  await popup.waitForSelector('#view-auth:not(.hidden)', { timeout: 10000 }).catch(() => {});
  record(side, 'popup arranca en vista auth', await popup.isVisible('#form-login'));

  await popup.fill('#form-login input[name=username]', 'lce_player_a');
  await popup.fill('#form-login input[name=password]', 'lce-test-2026');
  await popup.click('#form-login button[type=submit]');
  await popup.waitForSelector('#view-main:not(.hidden)', { timeout: 10000 }).catch(() => {});
  record(side, 'login entra a la vista principal', await popup.isVisible('#view-main'),
    `usuario=${await popup.textContent('#username-display').catch(() => '?')}`);

  const read = () =>
    popup.evaluate(() => ({
      mine: [...document.querySelectorAll('#my-packs .pack-card')].map((c) => c.querySelector('.pack-name')?.textContent),
      store: [...document.querySelectorAll('#store-packs .pack-card')].map((c) => c.querySelector('.pack-name')?.textContent),
    }));
  const before = await read();
  record(side, 'pack gratuito visible', before.mine.includes('Smileys'), JSON.stringify(before));
  record(side, 'pack de pago en el store', before.store.includes('Chess Plus'), JSON.stringify(before));

  await popup.click('#store-packs .pack-card button');
  await popup.waitForTimeout(1500);
  const after = await read();
  record(side, 'adquirir pack lo mueve a mis packs', after.mine.includes('Chess Plus') && !after.store.includes('Chess Plus'), JSON.stringify(after));

  const catalog = await first.page.evaluate(
    () => new Promise((res) => chrome.runtime.sendMessage({ type: 'GET_EMOJI_CATALOG' }, res)),
  );
  record(side, 'catálogo incluye el pack adquirido', (catalog?.userPacks ?? []).some((p) => p.slug === 'chess-plus'),
    `userPacks=${(catalog?.userPacks ?? []).map((p) => p.slug).join(',')}`);

  await popup.click('#btn-logout');
  await popup.waitForTimeout(1000);
  record(side, 'logout vuelve a la vista auth', await popup.isVisible('#view-auth'));
  record(side, 'popup sin errores JS', errors.length === 0, errors.join(' ~ ').slice(0, 200));
}

const extDir = await stageExtension();
const server = await serve(HARNESS, HARNESS_PORT);
const { chromium } = loadPlaywright();

let booted = [];
let exitCode = 0;
try {
  for (const side of ['a', 'b']) {
    const b = await boot(chromium, side, extDir);
    if (!b.extensionId) {
      console.error(
        `\nNo se pudo encontrar el service worker de la extensión en el perfil ${side.toUpperCase()}.\n` +
          'Playwright + extensión MV3 sin empaquetar no es fiable en esta máquina (ver e2e/README.md).\n' +
          'Prueba manual: python3 -m http.server 8849 y carga dist/ en Chrome como "Extensiones sin empaquetar".',
      );
      exitCode = 3;
      break;
    }
    booted.push(b);
    record(side, 'service worker registrado', true, `extensión=${b.extensionId}`);
    await b.page.waitForSelector('.lce-emoji-btn', { timeout: 15000 }).catch(() => {});
    await checkCatalogue(side, b.page);
    await checkInitialTransform(side, b.page);
    await checkPicker(side, b.page);
    await checkLiveMessage(side, b.page);
    await checkIdempotence(side, b.page);
  }
  if (booted.length === 2) await checkPopup('popup', booted[0]);
} finally {
  for (const b of booted) await b.context?.close();
  server.close();
  await rm(extDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
for (const f of failed) console.log(`  FALLA [${f.side}] ${f.name} ${f.detail}`);
process.exit(exitCode || (failed.length ? 1 : 0));
