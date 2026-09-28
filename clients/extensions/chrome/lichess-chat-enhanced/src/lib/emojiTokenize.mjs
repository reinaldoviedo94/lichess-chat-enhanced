// Tokeniza un texto con emojis `:slug:` en segmentos puros (sin DOM) para que la lógica de
// transformación sea testeable en node.
//
// El regex se crea DENTRO de la función en cada llamada: el historial de este proyecto usaba un
// regex global compartido (`/.../g`) con `lastIndex` entre llamadas, que era la fuente de bugs
// (una llamada veía que terminó donde había quedado la anterior). Crearlo local elimina eso de
// raíz.
//
// Resultado: lista de `{ type: 'text', text }` y `{ type: 'emoji', slug, known, data }`.
// `data` está presente solo si `slug` existía en `emojiMap` (`known === true`); un slug
// desconocido se marca `known: false, data: null` y el llamador lo deja como texto literal.

export function tokenizeEmoji(text, emojiMap) {
  const parts = [];
  const re = /:([a-z0-9_-]+):/g;
  let last = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', text: text.slice(last, match.index) });
    }
    const slug = match[1];
    const data = emojiMap[slug] ? { ...emojiMap[slug] } : null;
    parts.push({ type: 'emoji', slug, known: data !== null, data });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push({ type: 'text', text: text.slice(last) });
  }

  return parts;
}