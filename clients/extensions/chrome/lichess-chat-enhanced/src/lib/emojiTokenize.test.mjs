import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeEmoji } from './emojiTokenize.mjs';

const MAP = {
  smile: { image: 'u1', emoji_type: 'static', pack_slug: 'p1' },
  bounce: { image: 'u2', emoji_type: 'animated', pack_slug: 'p1' },
};

describe('tokenizeEmoji', () => {
  it('no hace nada con texto sin emojis', () => {
    assert.deepEqual(tokenizeEmoji('hola mundo', MAP), [{ type: 'text', text: 'hola mundo' }]);
  });

  it('tokeniza texto + emoji conocido + texto final', () => {
    const parts = tokenizeEmoji('hola :smile:', MAP);
    assert.deepEqual(parts, [
      { type: 'text', text: 'hola ' },
      { type: 'emoji', slug: 'smile', known: true, data: MAP.smile },
    ]);
  });

  it('marca como desconocido un slug que no existe', () => {
    const parts = tokenizeEmoji(':nope:', MAP);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].type, 'emoji');
    assert.equal(parts[0].slug, 'nope');
    assert.equal(parts[0].known, false);
    assert.equal(parts[0].data, null);
  });

  it('mezcla conocidos, desconocidos y texto en varias posiciones', () => {
    const parts = tokenizeEmoji('a :smile: b :ghost: c :bounce:', MAP);
    assert.deepEqual(
      parts.map((p) => (p.type === 'text' ? p.text : `${p.known ? 'K' : '?'}:${p.slug}`)),
      ['a ', 'K:smile', ' b ', '?:ghost', ' c ', 'K:bounce']
    );
  });

  it('no filtra por lastIndex de una llamada anterior (regresión del regex global)', () => {
    // Los dos textos terminan distinto: si el /g compartido arrastrara lastIndex, uno fallaría.
    assert.equal(tokenizeEmoji(':smile:', MAP).length, 1);
    assert.equal(tokenizeEmoji(':smile: y más', MAP).length, 2);
    assert.equal(tokenizeEmoji('solo texto', MAP).length, 1);
    assert.equal(tokenizeEmoji(':smile:', MAP).length, 1);
  });

  it('devuelve una copia del dato para el emoji (inmutable)', () => {
    const parts = tokenizeEmoji(':smile:', MAP);
    assert.notEqual(parts[0].data, MAP.smile);
    assert.deepEqual(parts[0].data, MAP.smile);
  });
});