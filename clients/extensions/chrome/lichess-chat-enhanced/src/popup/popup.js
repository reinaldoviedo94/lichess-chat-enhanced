import { api } from '../lib/api.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Views
const viewAuth = $('#view-auth');
const viewMain = $('#view-main');

// Auth
const tabs = $$('.tab');
const formLogin = $('#form-login');
const formRegister = $('#form-register');
const authError = $('#auth-error');

// Main
const usernameDisplay = $('#username-display');
const myPacksEl = $('#my-packs');
const storePacksEl = $('#store-packs');
const mainStatus = $('#main-status');

// Tab switching
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    formLogin.classList.toggle('hidden', !isLogin);
    formRegister.classList.toggle('hidden', isLogin);
    authError.classList.add('hidden');
  });
});

// Login
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const form = new FormData(formLogin);
  const { ok, data } = await api.login(form.get('username'), form.get('password'));

  if (!ok) {
    showError(data.detail || 'Login failed');
    return;
  }

  chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' });
  await showMainView();
});

// Register
formRegister.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const form = new FormData(formRegister);
  const { ok, data } = await api.register(
    form.get('email'),
    form.get('username'),
    form.get('password'),
  );

  if (!ok) {
    const msg = Object.values(data).flat().join(', ');
    showError(msg || 'Registration failed');
    return;
  }

  // Auto-login after register
  const loginResult = await api.login(form.get('username'), form.get('password'));
  if (loginResult.ok) {
    chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' });
    await showMainView();
  }
});

// Logout
$('#btn-logout').addEventListener('click', async () => {
  await api.logout();
  chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' });
  showAuthView();
});

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

function showAuthView() {
  viewAuth.classList.remove('hidden');
  viewMain.classList.add('hidden');
}

async function showMainView() {
  const user = await api.me();
  if (!user) {
    showAuthView();
    return;
  }

  viewAuth.classList.add('hidden');
  viewMain.classList.remove('hidden');
  usernameDisplay.textContent = user.username;

  await loadPacks();
}

async function loadPacks() {
  myPacksEl.innerHTML = '';
  storePacksEl.innerHTML = '';

  const [freePacks, myPacksData, storePacks] = await Promise.all([
    api.getFreePacks(),
    api.getMyPacks(),
    api.getStorePacks(),
  ]);

  // Free packs
  for (const pack of freePacks) {
    myPacksEl.appendChild(createPackCard(pack, 'free'));
  }

  // Purchased packs
  const ownedSlugs = new Set();
  for (const userPack of myPacksData) {
    const pack = userPack.pack;
    ownedSlugs.add(pack.slug);
    myPacksEl.appendChild(createPackCard(pack, 'owned'));
  }

  if (!freePacks.length && !myPacksData.length) {
    myPacksEl.innerHTML = '<span class="pack-count">No packs yet</span>';
  }

  // Store
  for (const pack of storePacks) {
    if (!ownedSlugs.has(pack.slug)) {
      storePacksEl.appendChild(createPackCard(pack, 'store'));
    }
  }

  if (!storePacksEl.children.length) {
    storePacksEl.innerHTML = '<span class="pack-count">No packs available</span>';
  }
}

function createPackCard(pack, type) {
  const card = document.createElement('div');
  card.className = 'pack-card';

  const info = document.createElement('div');
  info.className = 'pack-info';
  info.innerHTML = `
    <span class="pack-name">${pack.name}</span>
    <span class="pack-count">${pack.emoji_count ?? pack.emojis?.length ?? 0} emojis</span>
  `;

  card.appendChild(info);

  if (type === 'free') {
    const badge = document.createElement('span');
    badge.className = 'owned';
    badge.textContent = 'FREE';
    card.appendChild(badge);
  } else if (type === 'owned') {
    const badge = document.createElement('span');
    badge.className = 'owned';
    badge.textContent = 'OWNED';
    card.appendChild(badge);
  } else if (type === 'store') {
    const btn = document.createElement('button');
    btn.textContent = 'Get';
    btn.addEventListener('click', async () => {
      const { ok, data } = await api.acquirePack(pack.slug);
      if (ok) {
        chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' });
        await loadPacks();
      } else {
        mainStatus.textContent = data.error || 'Failed';
        mainStatus.classList.remove('hidden');
      }
    });
    card.appendChild(btn);
  }

  return card;
}

// Init: check if logged in
(async () => {
  const user = await api.me();
  if (user) {
    await showMainView();
  } else {
    showAuthView();
  }
})();
