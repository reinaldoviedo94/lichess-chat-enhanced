#!/usr/bin/env node
// Genera el CSS de tokens a partir de docs/design/tokens.json.
//
//   node scripts/tokens-to-css.mjs           # escribe los .css generados
//   node scripts/tokens-to-css.mjs --check   # solo verifica que estén al día (para CI)
//
// El CSS generado lleva un aviso y no se edita a mano: se cambia tokens.json y se vuelve a
// ejecutar. Las validaciones que fallan cortan con código 1 y un mensaje accionable, porque
// un tokens.css desincronizado es la forma más silenciosa de romper el tema.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'docs/design/tokens.json');
const PREFIX = '--lce';
const HEADER = [
  '/* Generado por scripts/tokens-to-css.mjs desde docs/design/tokens.json.',
  ' * NO EDITAR A MANO: editá tokens.json y volvé a correr el generador. */',
].join('\n');

const GROUPS = ['color', 'radius', 'space', 'size', 'font', 'shadow', 'z', 'motion'];
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|transparent|currentColor)$/i;
const LENGTH_VALUE = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|dvh|ch)$/;
const TIME_VALUE = /^\d+ms$/;
const FUNCTION_VALUE = /^(cubic-bezier|linear|steps|ease)(.*)$/;

const errors = [];
const fail = (message) => errors.push(message);

/** Un valor es válido si encaja en *alguna* de las familias declaradas para su grupo. */
function isValidValue(group, value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (group === 'color') return COLOR_VALUE.test(value);
  if (group === 'shadow') return value.length > 0;
  if (group === 'z') return /^\d+$/.test(value);
  if (group === 'motion') return TIME_VALUE.test(value) || FUNCTION_VALUE.test(value) || value === 'normal';
  if (group === 'font') {
    return value.includes(',') || LENGTH_VALUE.test(value) || /^\d+$/.test(value);
  }
  return LENGTH_VALUE.test(value);
}

function validate(themeName, theme) {
  if (typeof theme.selector !== 'string' || theme.selector.trim() === '') {
    fail(`theme "${themeName}": falta "selector"`);
  }
  for (const group of GROUPS) {
    const values = theme[group];
    if (values === undefined) {
      fail(`theme "${themeName}": falta el grupo "${group}"`);
      continue;
    }
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      fail(`theme "${themeName}": el grupo "${group}" debe ser un objeto`);
      continue;
    }
    const keys = Object.keys(values);
    if (keys.length === 0) fail(`theme "${themeName}": el grupo "${group}" está vacío`);

    for (const [key, value] of Object.entries(values)) {
      if (!/^[a-z0-9-]+$/.test(key)) {
        fail(`theme "${themeName}": clave inválida "${group}.${key}" (solo minúsculas, dígitos y guiones)`);
      }
      if (!isValidValue(group, value)) {
        fail(`theme "${themeName}": valor inválido "${group}.${key}": ${JSON.stringify(value)}`);
      }
    }
  }

  // Una clave que existe en light y no en dark (o al revés) es un bug silencioso: el CSS
  // oscuro heredaría el valor claro. Se compara el conjunto completo.
  return new Set(GROUPS.flatMap((group) => Object.keys(theme[group] ?? {}).map((key) => `${group}.${key}`)));
}

function compareThemes(lightKeys, darkKeys) {
  const missingInDark = [...lightKeys].filter((key) => !darkKeys.has(key));
  const missingInLight = [...darkKeys].filter((key) => !lightKeys.has(key));
  for (const key of missingInDark) fail(`"dark" no define ${key} (lo hereda de light sin querer)`);
  for (const key of missingInLight) fail(`"light" no define ${key} (sobra en dark)`);
}

function blockFor(themeName, theme) {
  const lines = [`${theme.selector} {`];
  for (const group of GROUPS) {
    const values = theme[group];
    if (!values) continue;
    lines.push(`  /* ${group} */`);
    for (const [key, value] of Object.entries(values)) {
      lines.push(`  ${PREFIX}-${group}-${key}: ${value};`);
    }
  }
  lines.push('}');
  return { themeName, text: lines.join('\n') };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const source = await readFile(SOURCE, 'utf8');

  let config;
  try {
    config = JSON.parse(source);
  } catch (error) {
    console.error(`tokens.json no es JSON válido: ${error.message}`);
    process.exit(1);
  }

  if (typeof config.version !== 'number') fail('falta "version" numérico');
  if (!config.generatedTo?.length) fail('falta "generatedTo" con al menos un destino');
  const themes = config.themes ?? {};
  if (!themes.light) fail('falta el theme "light"');
  if (!themes.dark) fail('falta el theme "dark"');

  if (themes.light && themes.dark) {
    compareThemes(validate('light', themes.light), validate('dark', themes.dark));
    if (themes.light.selector === themes.dark.selector) {
      fail('"light" y "dark" comparten selector: el oscuro pisa al claro');
    }
  }

  if (errors.length > 0) {
    console.error('tokens.json inválido:');
    for (const message of errors) console.error(`  - ${message}`);
    process.exit(1);
  }

  // El tema base se declara primero para que cualquier theme pueda sobreescribirlo con @media.
  const ordered = Object.entries(themes).map(([name, theme]) => blockFor(name, theme)).filter(Boolean);
  const css = [HEADER, '', ...ordered.flatMap((block, index) => [block.text, index < ordered.length - 1 ? '' : '']), ''].join('\n');
  const outputs = config.generatedTo.map((target) => resolve(ROOT, target));

  let stale = 0;
  for (const target of outputs) {
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current === css) continue;
    if (checkOnly) {
      stale += 1;
      console.error(`desactualizado: ${relative(ROOT, target)}`);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, css, 'utf8');
    console.log(`escrito: ${relative(ROOT, target)} (${css.length} bytes)`);
  }

  if (stale > 0) {
    console.error(`\n${stale} archivo(s) desactualizados. Corré: node scripts/tokens-to-css.mjs`);
    process.exit(1);
  }
  if (checkOnly) console.log('tokens al día');
}

await main();
