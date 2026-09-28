import { readFile } from 'node:fs/promises';
import { loadPlaywright } from './lib/playwright-host.mjs';

const pw = loadPlaywright();
const DATA = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const CAT = { freePacks: [{ slug: 'demo', emojis: [{ slug: 'smile', image: DATA, emoji_type: 'static' }] }], userPacks: [] };
const BODY = `<!doctype html><body><section class="mchat"><div class="mchat__content discussion"><ol class="mchat__messages"><li><span class="text">hi :smile:</span></li></ol></div><form class="mchat__form"><input class="mchat__say" type="text"></form></section></body>`;

const browser = await pw.chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('[LCE]')) console.log('CONSOLE', m.type(), m.text()); });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.addInitScript((cat) => {
  window.__CAT = cat;
  const listeners = new Set();
  window.chrome = { runtime: { onMessage: { addListener: f => listeners.add(f) }, sendMessage: (t, p, c) => { if (typeof p === 'function') c = p; if (t === 'GET_EMOJI_CATALOG') c(window.__CAT); else c(null); } } };
}, CAT);
await page.setContent(BODY);
const src = await readFile('dist/content.js', 'utf8');
await page.addScriptTag({ content: src });
await new Promise(r => setTimeout(r, 400));
console.log(await page.evaluate(() => ({ btn: document.querySelectorAll('.lce-emoji-btn').length, wrap: !!document.querySelector('.lce-input-wrapper'), picker: !!document.querySelector('.lce-picker') })));
await browser.close();