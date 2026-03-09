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

async function loadCatalog() {
  try {
    const freePacks = await api.getFreePacks();
    const { accessToken } = await api.getTokens();

    let userPacks = [];
    if (accessToken) {
      const myPacksResponse = await api.getMyPacks();
      userPacks = myPacksResponse.map((up) => up.pack);
    }

    return { freePacks, userPacks };
  } catch (e) {
    console.error('[LCE] Failed to load catalog:', e);
    return { freePacks: [], userPacks: [] };
  }
}
