import lottie from 'lottie-web/build/player/lottie_light.min.js';

const EMOJI_REGEX = /:([a-z0-9_-]+):/g;
const LCE_ATTR = 'data-lce-processed';

let emojiMap = {}; // slug -> { image, emoji_type, pack_slug }
let pickerVisible = false;
let pickerEl = null;
let buttonEl = null;
let isTransforming = false;
let transformDebounceTimer = null;

// --- Lifecycle / mount state ---
// La fuente de verdad del montaje es `mountedContent`: el nodo .mchat__content sobre el que
// estamos montados. Antes esto era un booleano `initialized` que se quedaba a true para siempre:
// cuando lila re-renderizaba el chat (cambio de partida/tema/sala) el panel moría sin recuperarse.
let mountedContent = null; // .mchat__content actualmente montado (o null)
let chatInputEl = null;    // input que envolvemos
let outsideClickHandler = null;
let catalogLoaded = false;
let setupTimer = null;     // debounce de (re)montajes

// --- Catalog Loading ---

async function loadCatalog() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_EMOJI_CATALOG' }, (catalog) => {
      if (catalog) {
        emojiMap = {};
        const allPacks = [...(catalog.freePacks || []), ...(catalog.userPacks || [])];

        for (const pack of allPacks) {
          for (const emoji of pack.emojis || []) {
            emojiMap[emoji.slug] = {
              image: emoji.image,
              emoji_type: emoji.emoji_type,
              pack_slug: pack.slug,
            };
          }
        }
      }

      catalogLoaded = true;
      resolve();
    });
  });
}

// --- Emoji Replacement in Chat ---

function transformChatMessages(chatContent, showToasts = false) {
  const walker = document.createTreeWalker(chatContent, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement?.closest(`[${LCE_ATTR}]`)) {
      textNodes.push(walker.currentNode);
    }
  }

  for (const textNode of textNodes) {
    if (!EMOJI_REGEX.test(textNode.nodeValue)) continue;
    EMOJI_REGEX.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = EMOJI_REGEX.exec(textNode.nodeValue)) !== null) {
      const slug = match[1];
      const emojiData = emojiMap[slug];

      // Add text before match
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(textNode.nodeValue.slice(lastIndex, match.index)));
      }

      if (emojiData) {
        const span = document.createElement('span');
        span.setAttribute(LCE_ATTR, '1');
        span.className = 'lce-emoji';
        span.title = `:${slug}:`;

        if (emojiData.emoji_type === 'animated') {
          span.className = 'lce-emoji lce-emoji-animated';
          loadLottieEmoji(span, emojiData.image);
        } else {
          const img = document.createElement('img');
          img.src = emojiData.image;
          img.alt = slug;
          img.className = 'lce-emoji-img';
          span.appendChild(img);
        }

        fragment.appendChild(span);

        // Show toast for new messages
        if (showToasts) showEmojiToast(slug, emojiData);
      } else {
        // Unknown emoji, leave as text
        fragment.appendChild(document.createTextNode(match[0]));
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < textNode.nodeValue.length) {
      fragment.appendChild(document.createTextNode(textNode.nodeValue.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }
}

function loadLottieEmoji(container, url) {
  // Fetch the JSON via background script to avoid mixed content
  chrome.runtime.sendMessage({ type: 'FETCH_JSON', url }, (data) => {
    if (!data) return;
    try {
      lottie.loadAnimation({
        container,
        animationData: data,
        renderer: 'svg',
        loop: true,
        autoplay: true,
      });
    } catch (e) {
      console.warn('[LCE] Lottie render failed:', e);
    }
  });
}

// --- Emoji Toast (reaction overlay) ---

let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return;
  toastContainer = document.createElement('div');
  toastContainer.className = 'lce-toast-container';
  document.body.appendChild(toastContainer);
}

function showEmojiToast(slug, emojiData) {
  ensureToastContainer();

  const toast = document.createElement('div');
  toast.className = 'lce-toast';

  if (emojiData.emoji_type === 'animated') {
    toast.className = 'lce-toast lce-toast-lottie';
    chrome.runtime.sendMessage({ type: 'FETCH_JSON', url: emojiData.image }, (data) => {
      if (!data) return;
      try {
        const anim = lottie.loadAnimation({
          container: toast,
          animationData: data,
          renderer: 'svg',
          loop: true,
          autoplay: true,
        });
        // Destroy lottie instance on removal
        toast.addEventListener('animationend', () => anim.destroy());
      } catch (e) { /* ignore */ }
    });
  } else {
    const img = document.createElement('img');
    img.src = emojiData.image;
    img.alt = slug;
    toast.appendChild(img);
  }

  toastContainer.appendChild(toast);

  // Trigger fade-out after 3s, remove after animation ends. Bajo prefers-reduced-motion
  // `animationend` nunca dispara (animation:none), así que hay un timer de seguridad.
  setTimeout(() => {
    toast.classList.add('lce-toast-out');
    toast.addEventListener('animationend', () => toast.remove());
    setTimeout(() => toast.remove(), 700);
  }, 3000);
}

function safeTransform(chatContent, showToasts = false) {
  isTransforming = true;
  try {
    transformChatMessages(chatContent, showToasts);
  } finally {
    isTransforming = false;
  }
}

// --- Emoji Picker UI ---

function setPickerExpanded(expanded) {
  if (buttonEl) buttonEl.setAttribute('aria-expanded', String(expanded));
}

function mountPicker(chatInput) {
  chatInputEl = chatInput;

  // Envolvemos el input con un wrapper sin romper el layout original de lila: guardamos el
  // punto de inserción (padre + siguiente hermano) para poder des-envolver en unmountPicker().
  const wrapper = document.createElement('div');
  wrapper.className = 'lce-input-wrapper';
  const originalParent = chatInput.parentNode;
  const nextSibling = chatInput.nextSibling;
  originalParent.insertBefore(wrapper, chatInput);
  wrapper.appendChild(chatInput);

  // Emoji button
  buttonEl = document.createElement('button');
  buttonEl.className = 'lce-emoji-btn';
  buttonEl.textContent = '\u{1F60A}';
  buttonEl.type = 'button';
  buttonEl.setAttribute('aria-haspopup', 'dialog');
  buttonEl.setAttribute('aria-expanded', 'false');
  buttonEl.setAttribute('aria-label', 'Abrir selector de emojis');
  buttonEl.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePicker();
  });
  wrapper.appendChild(buttonEl);

  // Picker container
  pickerEl = document.createElement('div');
  pickerEl.className = 'lce-picker';
  pickerEl.style.display = 'none';
  wrapper.appendChild(pickerEl);

  // Close on outside click. El handler se guarda para poder quitarlo en unmountPicker()
  // (si no, cada remount añade un listener que se filtra).
  outsideClickHandler = (e) => {
    if (pickerVisible && !pickerEl.contains(e.target) && e.target !== buttonEl) {
      hidePicker();
    }
  };
  document.addEventListener('click', outsideClickHandler, true);

  renderPicker(chatInput);
}

function unmountPicker() {
  if (!chatInputEl) return;

  if (outsideClickHandler) {
    document.removeEventListener('click', outsideClickHandler, true);
    outsideClickHandler = null;
  }

  // Devuelve el input a su padre real (reemplaza el wrapper): si no, un input huérfano
  // dentro de un wrapper muerto deja al usuario sin campo de chat tras un re-render.
  const wrapper = chatInputEl.closest('.lce-input-wrapper');
  if (wrapper && wrapper.parentNode) wrapper.replaceWith(chatInputEl);

  pickerEl = null;
  buttonEl = null;
  chatInputEl = null;
  pickerVisible = false;
}

function togglePicker() {
  pickerVisible = !pickerVisible;
  if (pickerEl) pickerEl.style.display = pickerVisible ? 'block' : 'none';
  setPickerExpanded(pickerVisible);
}

function hidePicker() {
  pickerVisible = false;
  if (pickerEl) pickerEl.style.display = 'none';
  setPickerExpanded(false);
}

function renderPicker(chatInput) {
  pickerEl.innerHTML = '';

  // Group emojis by pack
  const packs = {};
  for (const [slug, data] of Object.entries(emojiMap)) {
    const packSlug = data.pack_slug;
    if (!packs[packSlug]) packs[packSlug] = [];
    packs[packSlug].push({ slug, ...data });
  }

  if (Object.keys(packs).length === 0) {
    pickerEl.innerHTML = '<div class="lce-picker-empty">No emojis loaded</div>';
    return;
  }

  for (const [packSlug, emojis] of Object.entries(packs)) {
    const section = document.createElement('div');
    section.className = 'lce-picker-section';

    const title = document.createElement('div');
    title.className = 'lce-picker-title';
    title.textContent = packSlug;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'lce-picker-grid';

    for (const emoji of emojis) {
      const item = document.createElement('button');
      item.className = 'lce-picker-item';
      item.type = 'button';
      item.title = `:${emoji.slug}:`;

      if (emoji.emoji_type === 'static') {
        const img = document.createElement('img');
        img.src = emoji.image;
        img.alt = emoji.slug;
        item.appendChild(img);
      } else {
        item.textContent = '\u{1F3AC}'; // clapper emoji as placeholder for animated
      }

      item.addEventListener('click', () => {
        insertEmoji(chatInput, emoji.slug);
      });

      grid.appendChild(item);
    }

    section.appendChild(grid);
    pickerEl.appendChild(section);
  }
}

function insertEmoji(chatInput, slug) {
  chatInput.value += `:${slug}:`;
  chatInput.focus();
  chatInput.dispatchEvent(new Event('input', { bubbles: true }));
  hidePicker();
}

// --- Mount lifecycle ---

function isChatConnected() {
  return !!mountedContent && mountedContent.isConnected;
}

/** Un remount o un teardown se debounea: lila dispara muchas mutaciones seguidas al cambiar
 *  de sala/tema y no queremos montar-desmontar una vez por mutación. */
function scheduleSync() {
  if (setupTimer) return;
  setupTimer = setTimeout(syncMount, 50);
}

function syncMount() {
  setupTimer = null;
  if (!catalogLoaded) return; // el boot ya correrá syncMount al terminar el catálogo

  const chatContent = document.querySelector('.mchat__content');
  const chatInput = document.querySelector('.mchat__say');

  // Sin chat a la vista -> desmontar lo que hubiera (el panel no debe quedar huérfano).
  if (!chatContent || !chatInput) {
    if (mountedContent) teardownMount();
    return;
  }

  // Ya montado y vivo sobre el mismo nodo: no hacer nada.
  if (chatContent === mountedContent && isChatConnected()) return;

  // Nodo nuevo (o el viejo fue detachado por lila): desmontar limpio y montar de nuevo.
  if (mountedContent) teardownMount();
  mountedContent = chatContent;
  mountPicker(chatInput);
  safeTransform(chatContent);
}

function teardownMount() {
  if (transformDebounceTimer) {
    clearTimeout(transformDebounceTimer);
    transformDebounceTimer = null;
  }
  unmountPicker();
  mountedContent = null;
}

/** Las mutaciones de *nosotros* (spans data-lce-processed, lottie, el picker, el wrapper) no
 *  deben tratarse como contenido entrante. Solo cuentan nodos reales dentro del chat montado. */
function hasIncomingContent(mutations) {
  return mutations.some((m) =>
    m.type === 'childList' &&
    [...m.addedNodes].some(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE &&
        isChatConnected() &&
        mountedContent.contains(n) &&
        !n.matches?.(`[${LCE_ATTR}]`) &&
        !n.closest?.(`[${LCE_ATTR}], .lce-emoji, .lce-picker, .lce-input-wrapper`)
    )
  );
}

// Observador permanente sobre el cuerpo: sobrevive a los re-renders de lila (que detachaban el
// nodo del observador anterior) y cubre tanto mensajes nuevos como remounts.
const pageObserver = new MutationObserver((mutations) => {
  const current = document.querySelector('.mchat__content');
  if (current !== mountedContent) {
    scheduleSync(); // remount o teardown, debouneado
    return;
  }
  if (isTransforming) return;
  if (!hasIncomingContent(mutations)) return;

  // Debounce para transformar en ráfaga sin pisarnos
  clearTimeout(transformDebounceTimer);
  transformDebounceTimer = setTimeout(() => {
    if (mountedContent) safeTransform(mountedContent, true);
  }, 100);
});

// Listen for reload signal from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'RELOAD_EMOJIS') {
    loadCatalog().then(() => {
      if (chatInputEl) renderPicker(chatInputEl);
      if (mountedContent && isChatConnected()) safeTransform(mountedContent);
    });
  }
});

// Start: un solo observador del cuerpo + arranque con el catálogo.
pageObserver.observe(document.body, { childList: true, subtree: true });
loadCatalog().then(syncMount);