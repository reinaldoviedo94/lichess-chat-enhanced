#!/usr/bin/env node
// Test del ciclo de vida del content script contra el DOM de lila (harness).
//
//   pnpm build && node e2e/lifecycle.test.mjs
//
// No carga la extensión: inyecta dist/content.js en una página llana con `chrome` simulado,
// igual que lo haría en un tab de lichess. El objetivo es la regresión del re-init: antes,
// `setup()` marcaba `initialized = true` y cuando lila re-renderizaba el chat el panel moría.
// Ahora un observador permanente del cuerpo re-monta y des-monta limpiamente.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib/playwright-host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(HERE, '..', 'dist');
const playwright = loadPlaywright();

let passed = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Catálogo mínimo: dos emojis estáticos (data URI) -> no metemos lottie en el test.
const DATA_URI = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="9" fill="orange"/></svg>').toString('base64');
const CATALOG = {
  freePacks: [
    { slug: 'demo', emojis: [
      { slug: 'smile', image: DATA_URI, emoji_type: 'static' },
      { slug: 'wink', image: DATA_URI, emoji_type: 'static' },
    ] },
  ],
  userPacks: [],
};

function chromeStub() {
  const listeners = new Set();
  const chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => listeners.add(fn),
        _fire: (message) => listeners.forEach((fn) => fn(message)),
      },
      sendMessage: (type, payload, cb) => {
        if (typeof payload === 'function') cb = payload;
        if (type === 'GET_EMOJI_CATALOG') cb(CATALOG);
        else if (type === 'FETCH_JSON') cb(null);
        else cb({ ok: true });
      },
    },
    __listeners: listeners,
  };
  window.chrome = chrome;
  // Algunos módulos hacen `chrome.runtime?.sendMessage(...)` en el arranque; dejar disponible.
  window.__fireReload = () => chrome.runtime.onMessage._fire({ type: 'RELOAD_EMOJIS' });
}

const HARNESS_BODY = `<!doctype html><html><body>
<section class="mchat">
  <div class="mchat__tabs"><button class="mchat__tab">Chat</button></div>
  <div class="mchat__content discussion">
    <ol class="mchat__messages">
      <li><a class="user-link">b</a> <span class="text">hi :smile:</span></li>
      <li><a class="user-link">a</a> <span class="text">plain :nope:</span></li>
    </ol>
  </div>
  <form class="mchat__form"><input class="mchat__say" type="text"></form>
</section>
<script>
  window.__receive = (text) => {
    const list = document.querySelector('.mchat__messages');
    const li = document.createElement('li');
    li.innerHTML = '<a class="user-link">b</a> <span class="text"></span>';
    li.querySelector('.text').textContent = text;
    list.appendChild(li);
  };
  // Simula el re-render completo de lila: nodo de contenido NUEVO + input NUEVO.
  window.__remount = () => {
    const section = document.querySelector('.mchat');
    const oldForm = section.querySelector('.mchat__form');
    const fresh = document.createElement('div');
    fresh.className = 'mchat__content discussion';
    fresh.innerHTML = '<ol class="mchat__messages"><li><a class="user-link">c</a> <span class="text">fresh :wink:</span></li></ol>';
    section.querySelector('.mchat__content').remove();
    section.appendChild(fresh);
    const newInput = document.createElement('input');
    newInput.className = 'mchat__say';
    newInput.type = 'text';
    const newForm = document.createElement('form');
    newForm.className = 'mchat__form';
    newForm.appendChild(newInput);
    oldForm.replaceWith(newForm);
  };
  // Simula "nadie en el chat": se va la UI y no vuelve.
  window.__takedown = () => {
    document.querySelector('.mchat').remove();
  };
</script>
</body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  const contentSrc = await readFile(resolve(EXT_DIST, 'content.js'), 'utf8');

  await page.addInitScript(chromeStub);
  await page.setContent(HARNESS_BODY);
  await page.addScriptTag({ content: contentSrc });

  // Esperar el montaje inicial (catalog -> syncMount).
  await page.waitForSelector('.lce-emoji-btn', { timeout: 4000 });
  await sleep(150); // margen para el transform inicial

  // A) Montaje inicial: un solo botón, input envuelto, mensaje transformado.
  const a = await page.evaluate(() => ({
    buttons: document.querySelectorAll('.lce-emoji-btn').length,
    wrapped: !!document.querySelector('input.mchat__say')?.closest('.lce-input-wrapper'),
    smileImg: !!document.querySelector('.mchat__content .lce-emoji-img'),
    expanded: document.querySelector('.lce-emoji-btn').getAttribute('aria-expanded'),
  }));
  assert('A mount inicial: 1 botón', a.buttons === 1, `buttons=${a.buttons}`);
  assert('A mount inicial: input envuelto', a.wrapped);
  assert('A mount inicial: :smile: transformado', a.smileImg);
  assert('A mount inicial: aria-expanded=false', a.expanded === 'false');

  // B) Mensaje entrante tras el boot sigue transformándose.
  await page.evaluate(() => window.__receive('hi :smile: again'));
  await sleep(250); // transform debounce 100ms
  const b = await page.evaluate(() =>
    [...document.querySelectorAll('.mchat__messages li .text')].filter((t) => t.textContent.includes('again')).length
  );
  assert('B mensaje nuevo se transforma', b === 1);

  // C) RE-RENDER de lila: reemplaza contenido + input. El botón NO debe duplicarse y el
  //    contenido nuevo debe quedar montado y transformado. (regresión principal)
  await page.evaluate(() => window.__remount());
  await sleep(300); // sync debounce 50ms + transform
  const c = await page.evaluate(() => ({
    buttons: document.querySelectorAll('.lce-emoji-btn').length,
    wrapped: !!document.querySelector('input.mchat__say')?.closest('.lce-input-wrapper'),
    freshImg: !![...document.querySelectorAll('.mchat__content .lce-emoji-img')].length,
    wrappers: document.querySelectorAll('.lce-input-wrapper').length,
    inputConnected: document.querySelector('input.mchat__say')?.isConnected,
  }));
  assert('C remount: 1 botón (sin duplicar)', c.buttons === 1, `buttons=${c.buttons}`);
  assert('C remount: input envuelto de nuevo', c.wrapped);
  assert('C remount: wrapper único', c.wrappers === 1, `wrappers=${c.wrappers}`);
  assert('C remount: input conectado', c.inputConnected === true);
  assert('C remount: :wink: fresco transformado', c.freshImg === true);

  // D) Teardown: desaparece el chat -> no debe quedar nada montado ni listener colgando.
  await page.evaluate(() => window.__takedown());
  await sleep(200);
  const d = await page.evaluate(() => ({
    buttons: document.querySelectorAll('.lce-emoji-btn').length,
    wrappers: document.querySelectorAll('.lce-input-wrapper').length,
    pickers: document.querySelectorAll('.lce-picker').length,
  }));
  assert('D teardown: 0 botones', d.buttons === 0, `buttons=${d.buttons}`);
  assert('D teardown: 0 wrappers', d.wrappers === 0, `wrappers=${d.wrappers}`);
  assert('D teardown: 0 pickers', d.pickers === 0, `pickers=${d.pickers}`);

  await browser.close();

  console.log(`\n${passed} pasaron, ${failures.length} fallaron`);
  if (failures.length > 0) process.exit(1);
}

await main();