const EMOJI_REGEX = /:([a-z0-9_-]+):/g;
const LCE_ATTR = 'data-lce-processed';

let emojiMap = {}; // slug -> { image, emoji_type, pack_slug }
let pickerVisible = false;
let pickerEl = null;
let buttonEl = null;
let initialized = false;

// --- Catalog Loading ---

async function loadCatalog() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_EMOJI_CATALOG' }, (catalog) => {
      if (!catalog) {
        resolve();
        return;
      }

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

      resolve();
    });
  });
}

// --- Emoji Replacement in Chat ---

function transformChatMessages(chatContent) {
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
          span.dataset.lottie = emojiData.image;
          span.textContent = ':' + slug + ':'; // placeholder until lottie loads
          loadLottieEmoji(span, emojiData.image);
        } else {
          const img = document.createElement('img');
          img.src = emojiData.image;
          img.alt = slug;
          img.className = 'lce-emoji-img';
          span.appendChild(img);
        }

        fragment.appendChild(span);
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

async function loadLottieEmoji(container, url) {
  try {
    const lottie = await import('lottie-web/build/player/lottie_light.min.js');
    container.textContent = '';
    lottie.default.loadAnimation({
      container,
      path: url,
      renderer: 'svg',
      loop: true,
      autoplay: true,
    });
  } catch (e) {
    console.warn('[LCE] Lottie load failed:', e);
  }
}

// --- Emoji Picker UI ---

function createPicker(chatInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'lce-input-wrapper';
  chatInput.parentNode.insertBefore(wrapper, chatInput);
  wrapper.appendChild(chatInput);

  // Emoji button
  buttonEl = document.createElement('button');
  buttonEl.className = 'lce-emoji-btn';
  buttonEl.textContent = '\u{1F60A}';
  buttonEl.type = 'button';
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

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (pickerVisible && !pickerEl.contains(e.target) && e.target !== buttonEl) {
      hidePicker();
    }
  });

  renderPicker(chatInput);
}

function togglePicker() {
  pickerVisible = !pickerVisible;
  pickerEl.style.display = pickerVisible ? 'block' : 'none';
}

function hidePicker() {
  pickerVisible = false;
  if (pickerEl) pickerEl.style.display = 'none';
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
        item.textContent = ':' + emoji.slug + ':';
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

// --- Initialization ---

function setup() {
  if (initialized) return;

  const chatContent = document.querySelector('.mchat__content');
  const chatInput = document.querySelector('.mchat__say');

  if (!chatContent || !chatInput) return;

  initialized = true;

  createPicker(chatInput);

  // Observe only the chat content area for new messages
  const observer = new MutationObserver(() => {
    transformChatMessages(chatContent);
  });
  observer.observe(chatContent, { childList: true, subtree: true });

  // Transform existing messages
  transformChatMessages(chatContent);
}

// Listen for reload signal from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'RELOAD_EMOJIS') {
    loadCatalog().then(() => {
      if (pickerEl) {
        const chatInput = document.querySelector('.mchat__say');
        if (chatInput) renderPicker(chatInput);
      }

      const chatContent = document.querySelector('.mchat__content');
      if (chatContent) transformChatMessages(chatContent);
    });
  }
});

// Wait for chat to appear (Lichess loads dynamically)
const pageObserver = new MutationObserver(() => {
  if (!initialized && document.querySelector('.mchat__content')) {
    loadCatalog().then(() => setup());
    pageObserver.disconnect();
  }
});

// Start
if (document.querySelector('.mchat__content')) {
  loadCatalog().then(() => setup());
} else {
  pageObserver.observe(document.body, { childList: true, subtree: true });
}
