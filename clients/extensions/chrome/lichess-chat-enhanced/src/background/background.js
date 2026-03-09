import { api } from '../lib/api.js';

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_AUTH_STATE') {
    api.me().then((user) => sendResponse({ user }));
    return true; // async response
  }

  if (message.type === 'GET_EMOJI_CATALOG') {
    loadCatalog().then((catalog) => sendResponse(catalog));
    return true;
  }

  if (message.type === 'FETCH_JSON') {
    fetch(message.url)
      .then((res) => res.json())
      .then((data) => sendResponse(data))
      .catch(() => sendResponse(null));
    return true;
  }

  if (message.type === 'AUTH_CHANGED') {
    // Notify all tabs that auth state changed
    chrome.tabs.query({ url: ['https://lichess.org/*', 'https://*.lichess.org/*'] }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'RELOAD_EMOJIS' });
      }
    });
  }
});

// Convert an image URL to a data URI (avoids mixed content on HTTPS pages)
async function toDataUri(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(url); // fallback to original URL
      reader.readAsDataURL(blob);
    });
  } catch {
    return url; // fallback
  }
}

async function convertPackImages(packs) {
  for (const pack of packs) {
    if (!pack.emojis) continue;
    await Promise.all(
      pack.emojis.map(async (emoji) => {
        if (emoji.emoji_type === 'static' && emoji.image) {
          emoji.image = await toDataUri(emoji.image);
        }
        // Animated (Lottie) URLs stay as-is — fetched via FETCH_JSON
      }),
    );
  }
  return packs;
}

async function loadCatalog() {
  try {
    const freePacks = await api.getFreePacks();
    const { accessToken } = await api.getTokens();

    let userPacks = [];
    if (accessToken) {
      const myPacksResponse = await api.getMyPacks();
      userPacks = myPacksResponse.map((up) => up.pack);
    }

    // Pre-fetch static images as data URIs to avoid mixed content
    await Promise.all([convertPackImages(freePacks), convertPackImages(userPacks)]);

    return { freePacks, userPacks };
  } catch (e) {
    console.error('[LCE] Failed to load catalog:', e);
    return { freePacks: [], userPacks: [] };
  }
}
