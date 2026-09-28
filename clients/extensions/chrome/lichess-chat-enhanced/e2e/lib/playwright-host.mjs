// Resolver Playwright desde el host (es una herramienta global del harness, no una
// dependencia del paquete), de la misma forma que e2e/run.mjs.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const PLAYWRIGHT_PATHS = [
  process.env.PLAYWRIGHT_PATH,
  '/home/reinaldo/.nvm/versions/node/v24.16.0/lib/node_modules/@playwright/mcp',
  '/usr/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright',
].filter(Boolean);

export function loadPlaywright() {
  for (const base of PLAYWRIGHT_PATHS) {
    try {
      return createRequire(join(base, 'package.json'))('playwright');
    } catch {
      /* siguiente candidato */
    }
  }
  throw new Error(
    'No se encontró Playwright. Instalalo globalmente: npm i -g playwright, o exportá PLAYWRIGHT_PATH'
  );
}