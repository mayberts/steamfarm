'use strict';

// ================================================================ helpers

const $ = (sel, root = document) => root.querySelector(sel);

/** Build an element: el('div', {class: 'x', onclick: fn}, child, 'text', ...) */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = Boolean(v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Small stroke icons (24x24 viewBox). Static strings only.
const ICONS = {
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 10.5v4M5 12.5h4"/><circle cx="15.5" cy="11.5" r=".6"/><circle cx="17.5" cy="13.5" r=".6"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8h14v-8M12 8S10.5 3 7.8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4.2-5a2.5 2.5 0 0 1 0 5"/>',
  cards: '<rect x="3" y="7" width="12" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  box: '<path d="M21 8v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8M2 3h20v5H2zM10 12h4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
};
const FILLED = new Set(['play', 'stop']);

function icon(name, extra = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `i ${FILLED.has(name) ? 'fill' : ''} ${extra}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    if (!node.firstChild) node.append(icon(node.dataset.icon));
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !url.startsWith('/api/auth')) {
    showLogin();
    throw new Error('Not logged in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, kind = '') {
  const node = el('div', { class: `toast ${kind}` }, message);
  $('#toasts').append(node);
  setTimeout(() => node.remove(), kind === 'err' ? 6000 : 3500);
}

const storage = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not important: preferences just won't persist.
    }
  },
};

const fmtTime = (ms) => new Date(ms).toLocaleTimeString();
const fmtHours = (min) => `${(min / 60).toFixed(1)} h`;
function fmtIn(ms) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function fmtElapsed(since) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

const headerUrl = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

/** A Steam header-image cover, falling back to the name on a gradient when the image is missing. */
function cover(appid, name, ...overlays) {
  const fallback = el('div', { class: 'fallback hidden' }, name);
  const img = appid
    ? el('img', {
        src: headerUrl(appid),
        alt: '',
        loading: 'lazy',
        onerror: (e) => {
          e.target.remove();
          fallback.classList.remove('hidden');
        },
      })
    : null;
  if (!img) fallback.classList.remove('hidden');
  return el('div', { class: 'cover' }, img, fallback, ...overlays);
}

const STATUS_LABEL = {
  stopped: 'Logged off',
  connecting: 'Connecting',
  awaiting_guard: 'Needs Steam Guard code',
  online: 'Online',
  error: 'Error',
};
const SOURCE_LABEL = { booster: 'Playtime booster', farming: 'Card farming', unlocker: 'Achievement unlocker' };

// ================================================================ state

let state = { accounts: [], log: [] };
let selected = storage.get('steamfarm-account', null);
let games = []; // owned games of the selected account
let gamesFor = null;
let loadingGames = false;
let freeState = null;
let pollTimer = null;
let built = null; // key of the page currently built
let search = '';
let sortMode = storage.get('steamfarm-sort', 'name');
let farmSettingsOpen = false;
let freeSettingsOpen = false;

function current() {
  return state.accounts.find((a) => a.username === selected) || null;
}
const accPath = (path) => `/api/accounts/${encodeURIComponent(current().username)}/${path}`;

async function act(method, path, body, okMessage) {
  if (!current()) return undefined;
  try {
    const res = await api(method, accPath(path), body);
    if (okMessage) toast(okMessage);
    return res;
  } catch (err) {
    toast(err.message, 'err');
    return undefined;
  } finally {
    refresh();
  }
}

// ================================================================ auth

function showLogin() {
  clearInterval(pollTimer);
  pollTimer = null;
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  $('#login-password').focus();
}

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, 3000);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('POST', '/api/auth/login', { password: $('#login-password').value });
    $('#login-password').value = '';
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout').catch(() => {});
  showLogin();
});

// ================================================================ routing

function route() {
  const [, page = 'games', arg] = (location.hash || '#/games').split('/');
  return { page, arg };
}

window.addEventListener('hashchange', () => {
  closeSidebar();
  render(true);
});

// ================================================================ refresh loop

async function refresh() {
  try {
    state = await api('GET', '/api/state');
  } catch {
    return;
  }
  if (!state.accounts.some((a) => a.username === selected)) selected = state.accounts[0]?.username ?? null;
  const acc = current();
  if (acc && acc.status === 'online' && gamesFor !== acc.username && !loadingGames) loadGames();
  if (route().page === 'free' || !freeState) {
    freeState = await api('GET', '/api/free-games').catch(() => freeState);
  }
  render(false);
}

async function loadGames(force = false) {
  const acc = current();
  if (!acc || acc.status !== 'online') return;
  loadingGames = true;
  try {
    games = await api('GET', `${accPath('games')}${force ? '?refresh=1' : ''}`);
    gamesFor = acc.username;
  } catch (err) {
    toast(`Could not load games: ${err.message}`, 'err');
  } finally {
    loadingGames = false;
  }
  render(false);
}

function selectAccount(username) {
  selected = username;
  storage.set('steamfarm-account', username);
  games = [];
  gamesFor = null;
  $('#account-menu').classList.add('hidden');
  refresh();
  render(true);
}

// ================================================================ chrome

function renderChrome(acc) {
  const { page } = route();
  for (const a of document.querySelectorAll('.side-nav a')) {
    const p = a.dataset.page;
    a.classList.toggle('active', p === page || (page === 'game' && p === 'games'));
  }
  $('#nav-idling').textContent = acc && acc.idling.length ? String(acc.idling.length) : '';
  $('#nav-free').textContent = freeState && freeState.promos.length ? String(freeState.promos.length) : '';

  $('#account-btn').replaceChildren(
    acc && acc.avatarUrl ? el('img', { class: 'avatar', src: acc.avatarUrl, alt: '' }) : el('span', { class: 'avatar' }),
    el('span', { class: 'who' },
      el('span', {}, acc ? acc.personaName || acc.username : 'No account'),
      el('span', {}, acc ? el('span', { class: 'row' }, el('span', { class: `dot ${acc.status}` }), STATUS_LABEL[acc.status]) : 'Add one to start'),
    ),
    icon('chevron'),
  );
  $('#account-menu').replaceChildren(
    ...state.accounts.map((a) =>
      el('button', { type: 'button', onclick: () => selectAccount(a.username) },
        el('span', { class: `dot ${a.status}` }), a.personaName || a.username)),
    el('button', { type: 'button', onclick: () => { $('#account-menu').classList.add('hidden'); openAddDialog(); } }, icon('plus'), 'Add account'),
  );

  // Status banner for anything that stops the account from working.
  const banner = $('#banner');
  if (!acc) {
    banner.replaceChildren();
    return;
  }
  const guardOpen = acc.status === 'awaiting_guard';
  const existingGuard = $('#guard-code');
  if (guardOpen && existingGuard && banner.dataset.kind === 'guard') return; // keep the input while typing
  banner.dataset.kind = guardOpen ? 'guard' : acc.status;
  if (acc.status === 'online' && !acc.playingBlocked) {
    banner.replaceChildren();
  } else if (acc.status === 'online') {
    banner.replaceChildren(el('div', { class: 'banner warn' }, 'Paused: you are playing on another device. Idling resumes when you stop.'));
  } else if (guardOpen) {
    banner.replaceChildren(
      el('form', { class: 'banner warn', onsubmit: submitGuard },
        el('span', {}, acc.statusMessage),
        el('span', { class: 'row' },
          el('input', { id: 'guard-code', placeholder: 'Steam Guard code', autocomplete: 'one-time-code' }),
          el('button', { type: 'submit' }, 'Submit')),
      ),
    );
  } else {
    banner.replaceChildren(
      el('div', { class: `banner ${acc.status === 'error' ? 'err' : ''}` },
        el('span', {}, `${STATUS_LABEL[acc.status]}${acc.statusMessage ? ` · ${acc.statusMessage}` : ''}`),
        acc.status === 'connecting'
          ? null
          : acc.hasLogin
            ? el('button', { onclick: () => act('POST', 'start') }, 'Log in')
            : el('button', { onclick: openAddDialog }, 'Re-authenticate'),
      ),
    );
  }
}

$('#account-btn').addEventListener('click', () => $('#account-menu').classList.toggle('hidden'));
document.addEventListener('click', (e) => {
  if (!e.target.closest('.side-account')) $('#account-menu').classList.add('hidden');
});
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.add('hidden');
}
$('#menu-btn').addEventListener('click', () => {
  $('#sidebar').classList.add('open');
  $('#scrim').classList.remove('hidden');
});
$('#scrim').addEventListener('click', closeSidebar);
$('#search').addEventListener('input', (e) => {
  search = e.target.value;
  const { page } = route();
  if (page !== 'games' && page !== 'favorites' && page !== 'unlocker' && page !== 'inventory') location.hash = '#/games';
  else render(false);
});

async function submitGuard(e) {
  e.preventDefault();
  const code = $('#guard-code').value.trim();
  if (code) await act('POST', 'guard', { code });
}

// ================================================================ pages

/**
 * Each page has build() for the parts with inputs (rebuilt only when the page
 * or account changes) and update() for live data (run on every poll).
 */
const PAGES = {
  games: { build: buildGames, update: updateGames },
  favorites: { build: (acc) => buildGames(acc, true), update: (acc) => updateGames(acc, true) },
  idling: { build: buildIdling, update: updateIdling },
  free: { build: buildFree, update: updateFree },
  farming: { build: buildFarming, update: updateFarming },
  unlocker: { build: buildUnlocker, update: updateUnlocker },
  game: { build: buildGame, update: updateGame },
  activity: { build: buildActivity, update: updateActivity },
  settings: { build: buildSettings, update: updateSettings },
  inventory: { build: buildInventory, update: updateInventory },
};

function render(force) {
  const acc = current();
  renderChrome(acc);
  const main = $('#main');
  if (!acc) {
    built = null;
    main.replaceChildren(
      el('div', { class: 'panel' },
        el('h2', {}, 'No accounts yet'),
        el('p', { class: 'muted' }, 'Add a Steam account to idle games, farm trading cards, manage achievements and claim free games.'),
        el('div', {}, el('button', { onclick: openAddDialog }, icon('plus'), 'Add account')),
      ),
    );
    return;
  }
  const { page, arg } = route();
  const def = PAGES[page] || PAGES.games;
  const key = `${acc.username}|${page}|${arg ?? ''}`;
  if (force || built !== key) {
    built = key;
    main.replaceChildren(...[].concat(def.build(acc, arg)).filter((c) => c !== null && c !== undefined && c !== false));
    hydrateIcons(main);
    main.dataset.sig = '';
  }
  def.update(acc, arg);
}

/** Only redraw a container when its inputs changed, so hover and scroll survive the poll. */
function redraw(container, signature, build) {
  if (!container || container.dataset.sig === signature) return;
  container.dataset.sig = signature;
  container.replaceChildren(...[].concat(build()).filter((c) => c !== null && c !== undefined && c !== false));
}

// ---------------------------------------------------------------- games

function sortedGames(list) {
  const out = [...list];
  if (sortMode === 'playtime-desc') out.sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);
  else if (sortMode === 'playtime-asc') out.sort((a, b) => a.playtimeMinutes - b.playtimeMinutes);
  else out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function filteredGames(acc, favoritesOnly) {
  const q = search.trim().toLowerCase();
  const fav = new Set(acc.favorites);
  return sortedGames(games).filter(
    (g) => (!favoritesOnly || fav.has(g.appid)) && (!q || g.name.toLowerCase().includes(q) || String(g.appid) === q),
  );
}

function buildGames(acc, favoritesOnly = false) {
  return [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, favoritesOnly ? 'Favorites' : 'Games'), el('div', { class: 'sub', id: 'games-count' })),
      el('div', { class: 'row' },
        el('select', {
          'aria-label': 'Sort',
          onchange: (e) => {
            sortMode = e.target.value;
            storage.set('steamfarm-sort', sortMode);
            render(false);
          },
        },
          el('option', { value: 'name', selected: sortMode === 'name' }, 'Name (A–Z)'),
          el('option', { value: 'playtime-desc', selected: sortMode === 'playtime-desc' }, 'Playtime (high to low)'),
          el('option', { value: 'playtime-asc', selected: sortMode === 'playtime-asc' }, 'Playtime (low to high)'),
        ),
        el('button', { class: 'icon-btn', title: 'Reload library', onclick: () => loadGames(true) }, icon('refresh')),
      ),
    ),
    el('div', { id: 'games-grid', class: 'grid' }),
  ];
}

function updateGames(acc, favoritesOnly = false) {
  const list = filteredGames(acc, favoritesOnly);
  const count = $('#games-count');
  if (count) count.textContent = acc.status !== 'online' ? 'Log in to see your games' : loadingGames && !games.length ? 'Loading library…' : `${list.length} game${list.length === 1 ? '' : 's'}`;
  const idling = new Map(acc.idling.map((i) => [i.appid, i]));
  const sig = JSON.stringify([list.length, list.slice(0, 300).map((g) => g.appid), [...idling.keys()], acc.settings.idleGames, acc.favorites, acc.status]);
  redraw($('#games-grid'), sig, () => {
    if (!list.length) {
      return el('div', { class: 'empty' },
        favoritesOnly ? 'No favorites yet. Use the heart on a game to add it here.' : games.length ? 'No games match your search.' : acc.status === 'online' ? 'Loading…' : 'Log in to see your games.');
    }
    return list.slice(0, 300).map((g) => gameCard(acc, g, idling.get(g.appid)));
  });
  tickTimers();
}

function gameCard(acc, g, idling) {
  const boosting = acc.settings.idleGames.includes(g.appid);
  const fav = acc.favorites.includes(g.appid);
  return el('div', { class: 'game-card' },
    el('a', { href: `#/game/${g.appid}`, title: `${g.name} · achievements` },
      cover(g.appid, g.name, idling ? el('span', { class: 'timer', 'data-since': idling.since }, fmtElapsed(idling.since)) : null)),
    el('div', { class: 'card-foot' },
      el('span', { class: 'name', title: g.name }, g.name),
      el('span', { class: 'hours' }, fmtHours(g.playtimeMinutes)),
      el('button', {
        class: `icon-btn plain ${boosting ? 'on' : ''}`,
        title: boosting ? 'Stop idling' : 'Idle this game',
        disabled: acc.status !== 'online',
        onclick: () => toggleIdle(g.appid, !boosting),
      }, icon(boosting ? 'stop' : 'play')),
      el('button', { class: 'icon-btn plain', title: 'Achievements', onclick: () => { location.hash = `#/game/${g.appid}`; } }, icon('trophy')),
      el('button', { class: `icon-btn plain ${fav ? 'fav-on' : ''}`, title: fav ? 'Remove from favorites' : 'Add to favorites', onclick: () => toggleFavorite(g.appid) }, icon('heart', fav ? 'fill' : '')),
    ),
  );
}

async function toggleIdle(appid, on) {
  const set = new Set(current().settings.idleGames);
  if (on) set.add(appid);
  else set.delete(appid);
  if (set.size > 32) {
    toast('Steam allows at most 32 games at once.', 'err');
    return;
  }
  await act('PUT', 'idle', { appids: [...set] });
}

async function toggleFavorite(appid) {
  const set = new Set(current().favorites);
  if (set.has(appid)) set.delete(appid);
  else set.add(appid);
  await act('PUT', 'favorites', { appids: [...set] });
}

const gameName = (appid) => games.find((g) => g.appid === appid)?.name ?? `App ${appid}`;

// ---------------------------------------------------------------- idling

function buildIdling() {
  return [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Idling'), el('div', { class: 'sub', id: 'idling-count' })),
      el('button', { class: 'light', onclick: stopAll }, icon('stop'), 'Stop all'),
    ),
    el('div', { id: 'idling-groups', class: 'stack' }),
  ];
}

function updateIdling(acc) {
  $('#idling-count').textContent = `${acc.idling.length} game${acc.idling.length === 1 ? '' : 's'} idling`;
  const sig = JSON.stringify([acc.idling.map((i) => [i.appid, i.source]), games.length]);
  redraw($('#idling-groups'), sig, () => {
    if (!acc.idling.length) {
      return el('div', { class: 'empty' }, 'Nothing is idling. Press play on a game, or start card farming or the achievement unlocker.');
    }
    return ['booster', 'farming', 'unlocker']
      .map((source) => [source, acc.idling.filter((i) => i.source === source)])
      .filter(([, items]) => items.length)
      .map(([source, items]) =>
        el('section', { class: 'stack' },
          el('div', { class: 'row between' },
            el('h3', { class: 'muted' }, `${SOURCE_LABEL[source]} (${items.length})`),
            el('button', { class: 'link', onclick: () => stopSource(source) }, icon('stop'), 'Stop'),
          ),
          el('div', { class: 'grid' },
            ...items.map((i) =>
              el('div', { class: 'game-card' },
                cover(i.appid, gameName(i.appid), el('span', { class: 'timer', 'data-since': i.since }, fmtElapsed(i.since))),
                el('div', { class: 'card-foot' }, el('span', { class: 'name' }, gameName(i.appid))),
              ),
            ),
          ),
        ),
      );
  });
  tickTimers();
}

async function stopSource(source) {
  if (source === 'booster') await act('PUT', 'idle', { appids: [] });
  else if (source === 'farming') await act('POST', 'farm/stop');
  else await act('DELETE', 'unlocker');
}

async function stopAll() {
  const acc = current();
  if (!acc.idling.length) return;
  if (!confirm('Stop all idling, card farming and the achievement unlocker?')) return;
  if (acc.settings.idleGames.length) await stopSource('booster');
  if (acc.farming.active) await stopSource('farming');
  if (acc.unlocker) await stopSource('unlocker');
}

function tickTimers() {
  for (const node of document.querySelectorAll('[data-since]')) node.textContent = fmtElapsed(Number(node.dataset.since));
  const next = $('#unlock-next');
  if (next && next.dataset.at) next.textContent = `Next unlock in ${fmtIn(Number(next.dataset.at))}`;
}
setInterval(tickTimers, 1000);

// ---------------------------------------------------------------- free games

function buildFree(acc) {
  return [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Free Games'), el('div', { class: 'sub', id: 'free-sub' })),
      el('div', { class: 'row' },
        el('button', { class: 'icon-btn', title: 'Check now', onclick: checkFreeGames }, icon('refresh')),
        el('button', { class: 'icon-btn', title: 'Alert settings', onclick: () => { freeSettingsOpen = !freeSettingsOpen; render(true); } }, icon('cog')),
      ),
    ),
    el('div', { class: 'split' },
      el('div', { id: 'free-grid', class: 'grid big' }),
      el('div', { class: 'stack' },
        el('div', { class: 'panel' },
          el('div', { class: 'row' }, icon('bell', 'gold'), el('h3', {}, 'Auto-claim')),
          el('p', { class: 'muted small' }, 'Paid games that go 100% off are free to keep. Steamfarm checks the store and can add them to this account for you.'),
          el('label', { class: 'check' },
            el('input', { type: 'checkbox', checked: acc.freeGames.autoClaim, onchange: (e) => act('PUT', 'settings', { autoClaimFree: e.target.checked }) }),
            'Automatically claim for this account'),
        ),
        licensePanel(acc),
        freeSettingsOpen ? freeSettingsPanel() : null,
      ),
    ),
  ];
}

const LICENSE_TYPES = [['game', 'Games'], ['dlc', 'DLC'], ['demo', 'Demos'], ['music', 'Soundtracks'], ['other', 'Other']];

function licensePanel(acc) {
  const l = acc.freeLicenses;
  const setTypes = () => {
    const types = [...document.querySelectorAll('.lic-type:checked')].map((c) => c.value);
    act('PUT', 'settings', { freeLicenses: { types } });
  };
  return el('div', { class: 'panel' },
    el('div', { class: 'row' }, icon('gift', 'gold'), el('h3', {}, 'Free licenses')),
    el('p', { class: 'muted small' },
      'Free-to-play games, demos and free packages, picked up from Steam\'s change feed as they appear, like ASF\'s FreePackages plugin. ',
      'Steam allows about 30 of these per 90 minutes, so Steamfarm claims up to 25 and then waits.'),
    el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: l.enabled, onchange: (e) => act('PUT', 'settings', { freeLicenses: { enabled: e.target.checked } }) }),
      'Claim free licenses for this account'),
    el('div', { class: 'row wrap' },
      ...LICENSE_TYPES.map(([value, label]) => el('label', { class: 'check' },
        el('input', { type: 'checkbox', class: 'lic-type', value, checked: l.types.includes(value), onchange: setTypes }), label)),
    ),
    el('div', { id: 'lic-status', class: 'muted small' }),
    el('div', { id: 'lic-list', class: 'log' }),
  );
}

function updateLicenses(acc) {
  const box = $('#lic-status');
  if (!box) return;
  const l = acc.freeLicenses;
  const w = freeState?.licenses;
  box.textContent = [
    l.enabled ? `${l.queued} queued · ${l.recent}/${l.limit} claimed in the last 90 min` : 'Off',
    l.pausedUntil ? `paused until ${fmtTime(l.pausedUntil)}` : '',
    w?.lastCheck ? `feed checked ${fmtTime(w.lastCheck)}` : w?.message || '',
  ].filter(Boolean).join(' · ');
  redraw($('#lic-list'), JSON.stringify([l.upNext, l.history]), () => [
    ...l.upNext.map((q) => el('div', { class: 'muted' }, `queued  ${q.kind}/${q.id}  ${q.name}`)),
    ...l.history.map((h) => el('div', { class: h.ok ? '' : 'warn', title: h.result }, `${fmtTime(h.at)}  ${h.kind}/${h.id}  ${h.name}${h.ok ? '' : ` (${h.result})`}`)),
  ]);
}

function freeSettingsPanel() {
  const s = freeState?.settings ?? { enabled: true, intervalMin: 60, webhookUrl: '' };
  return el('div', { class: 'panel' },
    el('h3', {}, 'Alert settings (all accounts)'),
    el('label', { class: 'check' }, el('input', { id: 'free-enabled', type: 'checkbox', checked: s.enabled }), 'Check for free games'),
    el('label', {}, 'Check every (minutes)', el('input', { id: 'free-interval', type: 'number', min: '15', max: '1440', value: s.intervalMin, class: 'w90' })),
    el('label', {}, 'Alert webhook (Discord or ntfy URL, optional)',
      el('input', { id: 'free-webhook', value: s.webhookUrl, placeholder: 'https://discord.com/api/webhooks/…' })),
    el('div', { class: 'row' },
      el('button', { onclick: saveFreeSettings }, 'Save'),
      el('button', { class: 'secondary', onclick: testWebhook }, 'Send test alert'),
    ),
  );
}

function updateFree(acc) {
  const promos = freeState?.promos ?? [];
  $('#free-sub').textContent = freeState
    ? `${promos.length ? `${promos.length} free game${promos.length === 1 ? '' : 's'} available` : freeState.message || 'Not checked yet'}${freeState.lastCheck ? ` · checked ${fmtTime(freeState.lastCheck)}` : ''}`
    : 'Loading…';
  updateLicenses(acc);
  const claimed = new Set(acc.freeGames.claimed);
  const sig = JSON.stringify([promos.map((p) => p.key), acc.freeGames, acc.status]);
  redraw($('#free-grid'), sig, () => {
    if (!promos.length) return el('div', { class: 'empty' }, 'No free-to-keep games right now. These come up every week or two.');
    return promos.map((p) =>
      el('div', { class: 'promo' },
        el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, cover(p.appid, p.name)),
        el('div', { class: 'row between' },
          el('h3', {}, p.name),
          claimed.has(p.key)
            ? el('span', { class: 'pill' }, 'In library')
            : acc.freeGames.skipped[p.key]
              ? el('button', { class: 'secondary', title: 'DLC for a game this account does not own. Click to try again.', disabled: acc.status !== 'online', onclick: () => claimFree(p) }, acc.freeGames.skipped[p.key])
              : el('button', { class: 'light', disabled: acc.status !== 'online', onclick: () => claimFree(p) }, icon('gift'), 'Claim'),
        ),
      ),
    );
  });
}

async function claimFree(promo) {
  const res = await act('POST', 'free-games/claim', { key: promo.key });
  if (res) toast(res.claimed ? `Claimed ${promo.name}` : `${promo.name} is already in your library`);
}

async function checkFreeGames() {
  $('#free-sub').textContent = 'Checking…';
  try {
    await api('POST', '/api/free-games/check');
  } catch (err) {
    toast(err.message, 'err');
  }
  freeState = await api('GET', '/api/free-games').catch(() => freeState);
  render(false);
}

async function saveFreeSettings() {
  try {
    await api('PUT', '/api/free-games/settings', {
      enabled: $('#free-enabled').checked,
      intervalMin: Number($('#free-interval').value),
      webhookUrl: $('#free-webhook').value,
    });
    toast('Alert settings saved');
    return true;
  } catch (err) {
    toast(err.message, 'err');
    return false;
  }
}

async function testWebhook() {
  if (!(await saveFreeSettings())) return;
  try {
    await api('POST', '/api/free-games/test-webhook');
    toast('Test alert sent');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ---------------------------------------------------------------- card farming

function buildFarming(acc) {
  const s = acc.settings.farm;
  return [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Card Farming'), el('div', { class: 'sub', id: 'farm-sub' })),
      el('div', { class: 'row' },
        el('span', { id: 'farm-toggle' }),
        el('button', { class: 'icon-btn', title: 'Farming settings', onclick: () => { farmSettingsOpen = !farmSettingsOpen; render(true); } }, icon('cog')),
      ),
    ),
    farmSettingsOpen
      ? el('div', { class: 'panel' },
          el('h3', {}, 'Farming settings'),
          el('div', { class: 'row wrap' },
            el('label', {}, 'Games at once', el('input', { id: 'farm-max', type: 'number', min: '1', max: '32', value: s.maxConcurrent, class: 'w90' })),
            el('label', {}, 'Re-check every (min)', el('input', { id: 'farm-interval', type: 'number', min: '5', max: '240', value: s.checkIntervalMin, class: 'w90' })),
            el('label', { class: 'grow' }, 'Never farm (app IDs, comma separated)', el('input', { id: 'farm-blacklist', value: s.blacklist.join(', ') })),
          ),
          el('label', { class: 'check' }, el('input', { id: 'farm-auto', type: 'checkbox', checked: s.autoStart }), 'Start farming automatically after login'),
          el('div', {}, el('button', { onclick: saveFarmSettings }, 'Save')),
        )
      : null,
    el('div', { id: 'farm-grid', class: 'grid' }),
  ].filter(Boolean);
}

function readFarmSettings() {
  if (!$('#farm-max')) return null;
  return {
    maxConcurrent: Number($('#farm-max').value),
    checkIntervalMin: Number($('#farm-interval').value),
    blacklist: $('#farm-blacklist').value.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    autoStart: $('#farm-auto').checked,
  };
}

async function saveFarmSettings() {
  await act('PUT', 'settings', { farm: readFarmSettings() }, 'Farming settings saved');
}

function updateFarming(acc) {
  const f = acc.farming;
  $('#farm-sub').textContent = f.active
    ? `${f.message || 'Checking badges…'}${f.lastCheck ? ` · checked ${fmtTime(f.lastCheck)}` : ''}`
    : f.message || 'Not farming';
  redraw($('#farm-toggle'), JSON.stringify([f.active, acc.status]), () =>
    f.active
      ? el('button', { class: 'secondary', onclick: () => act('POST', 'farm/stop') }, icon('stop'), 'Stop')
      : el('button', { class: 'light', disabled: acc.status !== 'online', onclick: startFarming }, icon('play'), 'Start'),
  );
  const max = acc.settings.farm.maxConcurrent;
  const playing = new Map(acc.idling.map((i) => [i.appid, i]));
  redraw($('#farm-grid'), JSON.stringify([f.games, max, [...playing.keys()]]), () => {
    if (!f.games.length) {
      return el('div', { class: 'empty' }, f.active ? 'Checking your badges…' : 'Press Start to find games with card drops left and idle them until every card has dropped.');
    }
    return f.games.map((g, i) =>
      el('div', { class: 'game-card' },
        cover(g.appid, g.name,
          el('span', { class: 'badge' }, `${g.dropsRemaining} drop${g.dropsRemaining === 1 ? '' : 's'}`),
          playing.has(g.appid) ? el('span', { class: 'timer', 'data-since': playing.get(g.appid).since }, '') : null),
        el('div', { class: 'card-foot' },
          el('span', { class: 'name' }, g.name),
          el('span', { class: 'hours' }, i < max ? `${g.hoursPlayed} h` : 'queued')),
      ),
    );
  });
  tickTimers();
}

async function startFarming() {
  const settings = readFarmSettings();
  if (settings) await act('PUT', 'settings', { farm: settings });
  await act('POST', 'farm/start', undefined, 'Card farming started');
}

// ---------------------------------------------------------------- achievement unlocker

/** Progress bar; the width is set through CSSOM because the CSP forbids inline style attributes. */
function progressBar(fraction) {
  const fill = el('div');
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  return el('div', { class: 'progress' }, fill);
}

function buildUnlocker() {
  return [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Achievement Unlocker'), el('div', { class: 'sub', id: 'unl-sub' })),
      el('span', { id: 'unl-actions' }),
    ),
    el('div', { id: 'unl-body' }),
  ];
}

function updateUnlocker(acc) {
  const u = acc.unlocker;
  $('#unl-sub').textContent = u ? 'Unlocking one achievement at a time with random delays' : 'Not running';
  redraw($('#unl-actions'), String(Boolean(u)), () =>
    u ? el('button', { class: 'secondary', onclick: () => act('DELETE', 'unlocker') }, icon('stop'), 'Stop') : '');
  if (u) {
    const done = u.total - u.remaining;
    redraw($('#unl-body'), JSON.stringify([u.appid, u.remaining, u.total, gamesFor]), () =>
      el('div', { class: 'panel current' },
        cover(u.appid, gameName(u.appid)),
        el('div', { class: 'stack' },
          el('span', { class: 'muted small' }, 'Current game'),
          el('h2', {}, gameName(u.appid)),
          progressBar(u.total ? done / u.total : 0),
          el('div', {}, `${u.remaining} achievement${u.remaining === 1 ? '' : 's'} remaining · ${done} unlocked so far`),
          el('div', { class: 'muted', id: 'unlock-next', 'data-at': u.nextAt }, `Next unlock in ${fmtIn(u.nextAt)}`),
          u.idle ? el('span', { class: 'pill' }, icon('play'), 'Idling while unlocking') : null,
          el('div', {}, el('a', { href: `#/game/${u.appid}` }, 'Open achievements')),
        ),
      ),
    );
    return;
  }
  const q = search.trim().toLowerCase();
  const picks = sortedGames(games).filter((g) => !q || g.name.toLowerCase().includes(q)).slice(0, 12);
  redraw($('#unl-body'), JSON.stringify(['pick', q, picks.map((g) => g.appid)]), () =>
    el('div', { class: 'stack' },
      el('p', { class: 'muted' }, 'Pick a game (use the search bar to find one), then choose "Unlock gradually" on its achievements page.'),
      el('div', { class: 'grid' },
        ...picks.map((g) =>
          el('a', { class: 'game-card', href: `#/game/${g.appid}` },
            cover(g.appid, g.name),
            el('div', { class: 'card-foot' }, el('span', { class: 'name' }, g.name)),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- achievement manager

let ach = { appid: null, list: [], loading: false, error: '', pending: new Map(), filter: '' };

function buildGame(acc, arg) {
  const appid = Number(arg);
  if (ach.appid !== appid) {
    ach = { appid, list: [], loading: true, error: '', pending: new Map(), filter: '' };
    // After this build is in the DOM: the loader re-renders, possibly synchronously.
    setTimeout(loadAchievements, 0);
  }
  return [
    el('div', {}, el('a', { href: '#/games', class: 'row muted' }, icon('back'), 'Games')),
    el('div', { class: 'page-head' },
      el('div', { class: 'game-head' },
        cover(appid, gameName(appid)),
        el('div', {}, el('h1', { id: 'ach-title' }, gameName(appid)), el('div', { class: 'sub', id: 'ach-sub' })),
      ),
      el('div', { class: 'row wrap', id: 'ach-actions' }),
    ),
    el('div', { class: 'row wrap between' },
      el('div', { class: 'tabs' }, el('button', { class: 'tab active', type: 'button' }, 'Achievements')),
      el('input', { placeholder: 'Filter achievements', value: ach.filter, oninput: (e) => { ach.filter = e.target.value; render(false); } }),
    ),
    el('div', { id: 'ach-list', class: 'ach-list' }),
    el('details', { class: 'panel' },
      el('summary', {}, el('strong', {}, 'Unlock gradually'), el('span', { class: 'muted' }, ' · one at a time with random, human-like delays')),
      el('div', { class: 'row wrap' },
        el('label', {}, 'Min delay (min)', el('input', { id: 'unl-min', type: 'number', min: '1', value: '5', class: 'w90' })),
        el('label', {}, 'Max delay (min)', el('input', { id: 'unl-max', type: 'number', min: '1', value: '30', class: 'w90' })),
        el('label', { class: 'check' }, el('input', { id: 'unl-idle', type: 'checkbox', checked: true }), 'Idle the game while unlocking'),
        el('button', { onclick: startUnlocker }, 'Start unlocker'),
      ),
    ),
  ];
}

async function loadAchievements() {
  const acc = current();
  if (!acc || acc.status !== 'online') {
    ach.loading = false;
    ach.error = 'Log in to see achievements.';
    render(false);
    return;
  }
  const appid = ach.appid;
  try {
    const res = await api('GET', accPath(`achievements/${appid}`));
    if (ach.appid !== appid) return;
    ach.list = res.achievements;
    ach.error = '';
  } catch (err) {
    ach.error = err.message;
  }
  ach.loading = false;
  render(false);
}

function updateGame(acc) {
  $('#ach-title').textContent = gameName(ach.appid);
  const unlocked = ach.list.filter((a) => a.unlocked).length;
  $('#ach-sub').textContent = ach.loading ? 'Loading achievements…' : ach.list.length ? `${unlocked} / ${ach.list.length} unlocked` : '';
  const boosting = acc.settings.idleGames.includes(ach.appid);
  redraw($('#ach-actions'), JSON.stringify([ach.pending.size, boosting, ach.list.length, acc.status]), () => [
    el('button', { class: 'secondary', disabled: acc.status !== 'online', onclick: () => toggleIdle(ach.appid, !boosting) }, icon(boosting ? 'stop' : 'play'), boosting ? 'Stop idling' : 'Idle'),
    el('button', { class: 'secondary', disabled: !ach.list.length, onclick: () => queueAll(true) }, 'Unlock all'),
    el('button', { class: 'secondary', disabled: !ach.list.length, onclick: () => queueAll(false) }, 'Lock all'),
    el('button', { disabled: !ach.pending.size, onclick: applyChanges }, ach.pending.size ? `Apply ${ach.pending.size} change${ach.pending.size === 1 ? '' : 's'}` : 'Apply changes'),
  ]);
  const q = ach.filter.trim().toLowerCase();
  const list = ach.list.filter((a) => !q || a.displayName.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
  redraw($('#ach-list'), JSON.stringify([ach.loading, ach.error, q, ach.list.map((a) => [a.name, a.unlocked]), [...ach.pending]]), () => {
    if (ach.loading) return el('div', { class: 'empty' }, 'Loading…');
    if (ach.error) return el('div', { class: 'empty error' }, ach.error);
    if (!ach.list.length) return el('div', { class: 'empty' }, 'This game has no achievements.');
    return list.map(achRow);
  });
}

function achRow(a) {
  const pending = ach.pending.has(a.name);
  const target = pending ? ach.pending.get(a.name) : a.unlocked;
  return el('div', { class: `ach ${pending ? 'pending' : ''}` },
    (target ? a.icon : a.iconGray) || a.icon
      ? el('img', { src: (target ? a.icon : a.iconGray) || a.icon, alt: '', loading: 'lazy' })
      : el('span', { class: 'ach-icon' }, icon('trophy')),
    el('div', {},
      el('div', { class: 'title' }, a.displayName, a.protected ? el('span', { class: 'pill', title: 'Only the game server can change this one' }, icon('lock'), 'protected') : ''),
      el('div', { class: 'desc' },
        a.description || (a.hidden ? 'Hidden achievement' : ''),
        a.unlocked && a.unlockTime ? ` · unlocked ${new Date(a.unlockTime * 1000).toLocaleDateString()}` : ''),
    ),
    el('span', { class: 'pct' }, a.percent !== undefined ? `${a.percent.toFixed(1)}%` : ''),
    a.protected
      ? el('span', {})
      : pending
        ? el('button', { class: 'undo', onclick: () => { ach.pending.delete(a.name); render(false); } }, target ? 'Will unlock · undo' : 'Will lock · undo')
        : el('button', { class: a.unlocked ? 'lock' : 'unlock', onclick: () => { ach.pending.set(a.name, !a.unlocked); render(false); } },
            icon(a.unlocked ? 'lock' : 'unlock'), a.unlocked ? 'Lock' : 'Unlock'),
  );
}

function queueAll(unlock) {
  for (const a of ach.list) {
    if (a.protected) continue;
    if (a.unlocked !== unlock) ach.pending.set(a.name, unlock);
    else ach.pending.delete(a.name);
  }
  render(false);
}

async function applyChanges() {
  const changes = Object.fromEntries(ach.pending);
  const n = ach.pending.size;
  if (!n || !confirm(`Apply ${n} achievement change${n === 1 ? '' : 's'}?`)) return;
  try {
    const res = await api('POST', accPath(`achievements/${ach.appid}`), { changes });
    toast(`Changed ${res.changed.length} achievement${res.changed.length === 1 ? '' : 's'}`);
    ach.pending.clear();
  } catch (err) {
    toast(err.message, 'err');
  }
  ach.loading = true;
  render(false);
  loadAchievements();
}

async function startUnlocker() {
  const res = await act('POST', 'unlocker', {
    appid: ach.appid,
    minDelaySec: Number($('#unl-min').value) * 60,
    maxDelaySec: Number($('#unl-max').value) * 60,
    idle: $('#unl-idle').checked,
  });
  if (res) {
    toast(`Unlocker started: ${res.queued} achievement${res.queued === 1 ? '' : 's'} queued`);
    location.hash = '#/unlocker';
  }
}

// ---------------------------------------------------------------- activity

function buildActivity() {
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Activity'), el('div', { class: 'sub' }, 'What this account has been doing'))),
    el('div', { class: 'panel' }, el('div', { id: 'activity-log', class: 'log' }, 'Loading…')),
  ];
}

function updateActivity() {
  api('GET', accPath('log'))
    .then((entries) => {
      const box = $('#activity-log');
      if (!box) return;
      redraw(box, JSON.stringify(entries.length ? [entries.length, entries[entries.length - 1].time] : []), () =>
        entries.length
          ? [...entries].reverse().map((e) => el('div', { class: e.level === 'info' ? '' : e.level === 'warn' ? 'warn' : 'error' }, `${fmtTime(e.time)}  ${e.message}`))
          : el('div', { class: 'muted' }, 'Nothing yet.'));
    })
    .catch(() => {});
}

// ---------------------------------------------------------------- settings

function buildSettings(acc) {
  const s = acc.settings;
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Settings'), el('div', { class: 'sub' }, 'Account and Steam presence'))),
    el('div', { class: 'panel' },
      el('div', { id: 'settings-profile' }),
      el('div', { class: 'row wrap', id: 'settings-actions' }),
    ),
    el('div', { class: 'panel' },
      el('h3', {}, 'Steam presence'),
      el('div', { class: 'row wrap' },
        el('label', {}, 'Online status',
          el('select', { id: 'set-persona' },
            ...['online', 'away', 'invisible', 'offline'].map((v) => el('option', { value: v, selected: s.personaState === v }, v[0].toUpperCase() + v.slice(1))))),
        el('label', { class: 'grow' }, 'Custom "playing" status (optional)',
          el('input', { id: 'set-status', value: s.customStatus, maxlength: '64', placeholder: 'e.g. AFK' })),
      ),
      el('label', {}, 'Shared secret for automatic 2FA (optional)',
        el('input', { id: 'set-secret', type: 'password', autocomplete: 'off', placeholder: acc.hasSharedSecret ? 'Saved (leave blank to keep)' : 'Not set' })),
      el('label', { class: 'check' }, el('input', { id: 'set-autostart', type: 'checkbox', checked: s.autoStart }), 'Log in automatically when the container starts'),
      el('div', {}, el('button', { onclick: saveSettings }, 'Save settings')),
    ),
  ];
}

function updateSettings(acc) {
  redraw($('#settings-profile'), JSON.stringify([acc.avatarUrl, acc.personaName, acc.status, acc.statusMessage]), () =>
    el('div', { class: 'profile' },
      acc.avatarUrl ? el('img', { class: 'avatar', src: acc.avatarUrl, alt: '' }) : el('span', { class: 'avatar' }),
      el('div', {},
        el('h2', {}, acc.personaName || acc.username),
        el('div', { class: 'muted small' }, acc.username, acc.steamId ? ` · ${acc.steamId}` : ''),
        el('div', { class: 'row small' }, el('span', { class: `dot ${acc.status}` }), STATUS_LABEL[acc.status], acc.statusMessage ? ` · ${acc.statusMessage}` : ''),
      ),
    ),
  );
  const running = acc.status !== 'stopped' && acc.status !== 'error';
  redraw($('#settings-actions'), JSON.stringify([running, acc.hasLogin]), () => [
    running
      ? el('button', { class: 'secondary', onclick: () => act('POST', 'stop') }, 'Log off')
      : el('button', { disabled: !acc.hasLogin, onclick: () => act('POST', 'start') }, 'Log in'),
    el('button', { class: 'secondary', onclick: openAddDialog }, acc.hasLogin ? 'Add another account' : 'Re-authenticate'),
    el('button', { class: 'danger', onclick: removeAccount }, 'Remove account'),
  ]);
}

async function saveSettings() {
  const body = {
    personaState: $('#set-persona').value,
    customStatus: $('#set-status').value,
    autoStart: $('#set-autostart').checked,
  };
  const secret = $('#set-secret').value.trim();
  if (secret) body.sharedSecret = secret;
  await act('PUT', 'settings', body, 'Settings saved');
  $('#set-secret').value = '';
}

async function removeAccount() {
  const acc = current();
  if (!acc || !confirm(`Remove ${acc.username}? Its saved login will be deleted.`)) return;
  await act('DELETE', '');
  selected = null;
  location.hash = '#/games';
}

// ---------------------------------------------------------------- inventory & market

// Same maths as the market page: 5% Steam fee and 10% publisher fee, each at least 1 cent.
const buyerPays = (seller) => seller + Math.floor(Math.max(seller * 0.05, 1)) + Math.floor(Math.max(seller * 0.1, 1));
function sellerReceives(buyer) {
  let seller = Math.max(0, Math.floor(buyer / 1.15) + 2);
  while (seller > 0 && buyerPays(seller) > buyer) seller--;
  return seller;
}
const MIN_PRICE = 3;

const KINDS = [
  ['all', 'All'], ['card', 'Cards'], ['foil', 'Foils'], ['background', 'Backgrounds'],
  ['emoticon', 'Emoticons'], ['booster', 'Boosters'], ['gems', 'Gems'], ['other', 'Other'],
];

let inv = { for: null, loading: false, error: '', currency: 'USD', items: [], tab: 'items', kind: 'all', marketableOnly: false, selected: new Map(), prices: new Map(), listings: null, listingsLoading: false, chosenListings: new Set() };

function money(cents) {
  if (cents === null || cents === undefined) return '–';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: inv.currency }).format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}
const toCents = (text) => {
  const n = Number(String(text).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

async function loadInventory(force = false) {
  const acc = current();
  if (!acc || acc.status !== 'online') return;
  inv.loading = true;
  inv.error = '';
  render(false);
  try {
    const res = await api('GET', `${accPath('inventory')}${force ? '?refresh=1' : ''}`);
    inv.items = res.items;
    inv.currency = res.currency;
    inv.for = acc.username;
    // Drop selections for items that are gone.
    const keys = new Set(res.items.map((i) => i.marketHashName));
    for (const k of [...inv.selected.keys()]) if (!keys.has(k)) inv.selected.delete(k);
  } catch (err) {
    inv.error = err.message;
  }
  inv.loading = false;
  render(false);
}

async function loadListings() {
  inv.listingsLoading = true;
  render(false);
  try {
    inv.listings = await api('GET', accPath('market/listings'));
  } catch (err) {
    toast(err.message, 'err');
    inv.listings = inv.listings ?? [];
  }
  inv.listingsLoading = false;
  inv.chosenListings.clear();
  render(false);
}

function buildInventory(acc) {
  if (inv.for !== acc.username) {
    inv = { ...inv, for: acc.username, items: [], selected: new Map(), listings: null, chosenListings: new Set() };
    setTimeout(() => loadInventory(), 0);
  }
  return [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Inventory Manager'), el('div', { class: 'sub', id: 'inv-sub' })),
      el('div', { class: 'row wrap', id: 'inv-actions' }),
    ),
    el('div', { id: 'inv-job' }),
    el('div', { class: 'row wrap between' },
      el('div', { class: 'tabs' },
        el('button', { class: `tab ${inv.tab === 'items' ? 'active' : ''}`, type: 'button', onclick: () => { inv.tab = 'items'; render(true); } }, 'Items'),
        el('button', { class: `tab ${inv.tab === 'listings' ? 'active' : ''}`, type: 'button', onclick: () => { inv.tab = 'listings'; if (!inv.listings) loadListings(); render(true); } }, 'My listings'),
      ),
      inv.tab === 'items'
        ? el('div', { class: 'row wrap' },
            el('select', { 'aria-label': 'Item type', onchange: (e) => { inv.kind = e.target.value; render(false); } },
              ...KINDS.map(([v, label]) => el('option', { value: v, selected: inv.kind === v }, label))),
            el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: inv.marketableOnly, onchange: (e) => { inv.marketableOnly = e.target.checked; render(false); } }), 'Marketable only'),
          )
        : null,
    ),
    el('div', { id: 'inv-body' }),
  ];
}

function visibleItems() {
  const q = search.trim().toLowerCase();
  return inv.items.filter((i) =>
    (inv.kind === 'all' || i.kind === inv.kind) &&
    (!inv.marketableOnly || i.marketable) &&
    (!q || i.name.toLowerCase().includes(q) || i.game.toLowerCase().includes(q) || i.type.toLowerCase().includes(q)));
}

function updateInventory(acc) {
  const copies = inv.items.reduce((n, i) => n + i.assetids.length, 0);
  $('#inv-sub').textContent = acc.status !== 'online'
    ? 'Log in to see your inventory'
    : inv.loading && !inv.items.length ? 'Loading inventory…' : `${copies} item${copies === 1 ? '' : 's'} · ${inv.items.length} distinct`;
  const selCount = [...inv.selected.values()].reduce((n, q) => n + q, 0);
  const job = acc.sellJob;
  redraw($('#inv-actions'), JSON.stringify([inv.tab, selCount, inv.loading, Boolean(job?.running), acc.status, inv.chosenListings.size, inv.listingsLoading]), () =>
    inv.tab === 'items'
      ? [
          el('button', { class: 'secondary', disabled: !inv.items.length, onclick: selectDuplicates }, 'Select duplicates'),
          selCount ? el('button', { class: 'secondary', onclick: () => { inv.selected.clear(); render(false); } }, 'Clear') : null,
          el('button', { class: 'light', disabled: !selCount || job?.running || acc.status !== 'online', onclick: openSellDialog }, icon('tag'), selCount ? `List ${selCount} selected` : 'List selected'),
          el('button', { class: 'icon-btn', title: 'Reload inventory', disabled: inv.loading, onclick: () => loadInventory(true) }, icon('refresh')),
        ]
      : [
          el('button', { class: 'danger', disabled: !inv.chosenListings.size, onclick: removeChosenListings }, `Remove ${inv.chosenListings.size || ''} selected`.replace('  ', ' ')),
          el('button', { class: 'icon-btn', title: 'Reload listings', disabled: inv.listingsLoading, onclick: loadListings }, icon('refresh')),
        ]);
  redraw($('#inv-job'), JSON.stringify(job), () => {
    if (!job || (!job.running && Date.now() - job.finishedAt > 10 * 60_000)) return '';
    return el('div', { class: `banner ${job.failed ? 'warn' : ''}` },
      el('div', { class: 'stack grow' },
        el('strong', {}, job.running ? `Listing items… ${job.done} / ${job.total}` : `Listed ${job.listed} of ${job.total} item${job.total === 1 ? '' : 's'}`),
        job.running ? progressBar(job.done / job.total) : null,
        job.needsConfirmation ? el('span', {}, `${job.needsConfirmation} listing${job.needsConfirmation === 1 ? '' : 's'} must be confirmed in the Steam mobile app (or by email) before they appear on the market.`) : null,
        ...job.errors.slice(0, 5).map((e) => el('span', { class: 'small error' }, e)),
      ),
    );
  });
  if (inv.tab === 'listings') return updateListings();
  const list = visibleItems();
  redraw($('#inv-body'), JSON.stringify([inv.loading, inv.error, list.map((i) => [i.marketHashName, i.assetids.length]), [...inv.selected], [...inv.prices.keys()].length, acc.status]), () => {
    if (acc.status !== 'online') return el('div', { class: 'empty' }, 'Log in to see your inventory.');
    if (inv.error) return el('div', { class: 'empty error' }, inv.error);
    if (inv.loading && !inv.items.length) return el('div', { class: 'empty' }, 'Loading…');
    if (!list.length) return el('div', { class: 'empty' }, inv.items.length ? 'No items match.' : 'No Steam community items in this inventory.');
    return el('div', { class: 'grid inv-grid' }, ...list.slice(0, 600).map(invTile));
  });
}

function invTile(item) {
  const sel = inv.selected.get(item.marketHashName) ?? 0;
  const price = inv.prices.get(item.marketHashName);
  const toggle = () => {
    if (!item.marketable) return;
    if (sel) inv.selected.delete(item.marketHashName);
    else inv.selected.set(item.marketHashName, item.assetids.length);
    render(false);
  };
  return el('div', { class: `inv-tile ${sel ? 'selected' : ''} ${item.marketable ? '' : 'locked'}`, onclick: toggle, title: item.marketable ? item.type : `${item.type} · not marketable` },
    el('div', { class: 'inv-top' },
      item.marketable ? el('input', { type: 'checkbox', checked: Boolean(sel), onclick: (e) => e.stopPropagation(), onchange: toggle, 'aria-label': `Select ${item.name}` }) : el('span', {}),
      item.marketable ? (item.assetids.length > 1 ? el('span', { class: 'pill' }, `×${item.assetids.length}`) : el('span', {})) : el('span', { class: 'muted' }, icon('lock')),
    ),
    el('img', { src: item.icon, alt: '', loading: 'lazy' }),
    el('div', { class: 'inv-name' }, item.name),
    el('div', { class: 'inv-type' }, item.type),
    el('div', { class: 'inv-price' }, sel && sel !== item.assetids.length ? `Selling ${sel} of ${item.assetids.length}` : price?.lowest ? money(price.lowest) : ''),
  );
}

function selectDuplicates() {
  inv.selected.clear();
  for (const i of inv.items) {
    // Keep one of each card for crafting; foils and boosters are worth keeping one too.
    if (i.marketable && i.assetids.length > 1 && i.kind !== 'gems') inv.selected.set(i.marketHashName, i.assetids.length - 1);
  }
  const n = [...inv.selected.values()].reduce((a, b) => a + b, 0);
  toast(n ? `Selected ${n} duplicate${n === 1 ? '' : 's'} (keeping one of each)` : 'No duplicates to sell');
  render(false);
}

// -------------------------------------------------------------- sell dialog

let sell = null;

function openSellDialog() {
  const rows = [...inv.selected]
    .map(([name, qty]) => ({ item: inv.items.find((i) => i.marketHashName === name), qty }))
    .filter((r) => r.item && r.item.marketable)
    .map((r) => ({ ...r, price: null, lowest: inv.prices.get(r.item.marketHashName)?.lowest ?? null, status: 'pending' }));
  sell = { rows, strategy: 'match', floor: MIN_PRICE, confirmed: false, fetching: true };
  for (const r of rows) if (r.lowest !== null) { r.status = 'ok'; r.price = priceFor(r.lowest); }
  renderSellDialog();
  $('#sell-dialog').showModal();
  fetchSellPrices();
}

function priceFor(lowest) {
  if (lowest === null) return null;
  const base = sell.strategy === 'undercut' ? lowest - 1 : lowest;
  return Math.max(sell.floor, MIN_PRICE, base);
}

async function fetchSellPrices() {
  for (const r of sell?.rows ?? []) {
    if (!sell || !$('#sell-dialog').open) return;
    if (r.status === 'ok') continue;
    try {
      const info = await api('GET', `${accPath('market/price')}?name=${encodeURIComponent(r.item.marketHashName)}`);
      inv.prices.set(r.item.marketHashName, info);
      r.lowest = info.lowest ?? info.median;
      r.status = r.lowest !== null ? 'ok' : 'none';
      if (r.price === null) r.price = priceFor(r.lowest);
    } catch (err) {
      r.status = 'error';
      r.error = err.message;
    }
    renderSellDialog();
  }
  if (sell) {
    sell.fetching = false;
    renderSellDialog();
  }
}

function sellTotals() {
  let copies = 0;
  let receive = 0;
  let missing = 0;
  for (const r of sell.rows) {
    if (r.price === null || r.price < MIN_PRICE) { missing++; continue; }
    copies += r.qty;
    receive += sellerReceives(r.price) * r.qty;
  }
  return { copies, receive, missing };
}

function renderSellDialog() {
  const d = $('#sell-dialog');
  if (!sell) return;
  // Keep focus in a price field while typing: only rebuild rows that are not being edited.
  const active = document.activeElement;
  if (active && active.dataset && active.dataset.row && d.contains(active)) {
    updateSellFooter();
    return;
  }
  const done = sell.rows.filter((r) => r.status !== 'pending').length;
  d.replaceChildren(
    el('div', { class: 'row between' },
      el('h2', {}, 'List on the Community Market'),
      el('button', { class: 'icon-btn plain', title: 'Close', onclick: closeSellDialog }, '✕'),
    ),
    el('p', { class: 'muted small' },
      'Prices are what the buyer pays. You receive that minus Steam’s fees (5% Steam + 10% publisher, minimum 1 each). ',
      sell.fetching ? `Fetching market prices ${done} / ${sell.rows.length}… (Steam limits how fast this can go)` : ''),
    el('div', { class: 'row wrap' },
      el('label', {}, 'Pricing',
        el('select', { onchange: (e) => { sell.strategy = e.target.value; repriceAll(); } },
          el('option', { value: 'match', selected: sell.strategy === 'match' }, 'Match lowest listing'),
          el('option', { value: 'undercut', selected: sell.strategy === 'undercut' }, 'Undercut lowest by 0.01'))),
      el('label', {}, 'Minimum price',
        el('input', { class: 'w90', value: (sell.floor / 100).toFixed(2), onchange: (e) => { const c = toCents(e.target.value); sell.floor = Number.isFinite(c) ? Math.max(MIN_PRICE, c) : MIN_PRICE; repriceAll(); } })),
    ),
    el('div', { class: 'sell-rows' },
      el('div', { class: 'sell-row head' }, el('span', {}), el('span', {}, 'Item'), el('span', {}, 'Qty'), el('span', {}, 'Lowest'), el('span', {}, 'Buyer pays'), el('span', {}, 'You get')),
      ...sell.rows.map((r, i) =>
        el('div', { class: 'sell-row' },
          el('img', { src: r.item.icon, alt: '' }),
          el('span', { class: 'sell-name', title: r.item.type }, r.item.name),
          el('input', { type: 'number', min: '1', max: String(r.item.assetids.length), value: r.qty, 'data-row': i, class: 'qty', onchange: (e) => { r.qty = Math.min(r.item.assetids.length, Math.max(1, Math.floor(Number(e.target.value) || 1))); e.target.value = r.qty; updateSellFooter(); } }),
          el('span', { class: 'muted small' }, r.status === 'pending' ? '…' : r.status === 'error' ? 'n/a' : money(r.lowest)),
          el('input', { value: r.price === null ? '' : (r.price / 100).toFixed(2), placeholder: r.status === 'pending' ? '…' : 'Set price', 'data-row': i, class: 'price', oninput: (e) => { const c = toCents(e.target.value); r.price = Number.isFinite(c) && c > 0 ? c : null; updateSellFooter(); }, onblur: () => renderSellDialog() }),
          el('span', { class: 'receive', id: `recv-${i}` }, r.price !== null && r.price >= MIN_PRICE ? money(sellerReceives(r.price)) : '–'),
        ),
      ),
    ),
    el('div', { id: 'sell-footer', class: 'stack' }),
  );
  updateSellFooter();
}

function repriceAll() {
  for (const r of sell.rows) if (r.lowest !== null) r.price = priceFor(r.lowest);
  renderSellDialog();
}

function updateSellFooter() {
  const footer = $('#sell-footer');
  if (!footer || !sell) return;
  sell.rows.forEach((r, i) => {
    const node = $(`#recv-${i}`);
    if (node) node.textContent = r.price !== null && r.price >= MIN_PRICE ? money(sellerReceives(r.price)) : '–';
  });
  const t = sellTotals();
  footer.replaceChildren(
    el('div', { class: 'row between wrap' },
      el('strong', {}, `${t.copies} item${t.copies === 1 ? '' : 's'} · you receive about ${money(t.receive)}`),
      t.missing ? el('span', { class: 'warn small' }, `${t.missing} item${t.missing === 1 ? '' : 's'} without a price will be skipped`) : null,
    ),
    el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: sell.confirmed, onchange: (e) => { sell.confirmed = e.target.checked; updateSellFooter(); } }),
      'I understand these items will be listed for sale on the Steam Community Market at these prices.'),
    el('div', { class: 'row end' },
      el('button', { class: 'secondary', onclick: closeSellDialog }, 'Cancel'),
      el('button', { disabled: !sell.confirmed || !t.copies, onclick: submitSell }, icon('tag'), `List ${t.copies} item${t.copies === 1 ? '' : 's'}`),
    ),
  );
}

function closeSellDialog() {
  sell = null;
  $('#sell-dialog').close();
}
$('#sell-dialog').addEventListener('close', () => { sell = null; });

async function submitSell() {
  const items = [];
  for (const r of sell.rows) {
    if (r.price === null || r.price < MIN_PRICE) continue;
    for (const assetid of r.item.assetids.slice(0, r.qty)) items.push({ assetid, price: r.price });
  }
  const res = await act('POST', 'market/sell', { items, confirm: true });
  if (res) {
    toast(`Listing ${res.queued} item${res.queued === 1 ? '' : 's'}… progress is shown on this page`);
    inv.selected.clear();
    closeSellDialog();
  }
}

// ----------------------------------------------------------------- listings

function updateListings() {
  redraw($('#inv-body'), JSON.stringify([inv.listingsLoading, inv.listings, [...inv.chosenListings]]), () => {
    if (inv.listingsLoading && !inv.listings) return el('div', { class: 'empty' }, 'Loading listings…');
    if (!inv.listings?.length) return el('div', { class: 'empty' }, 'You have no active market listings.');
    const total = inv.listings.reduce((n, l) => n + l.sellerPrice, 0);
    return el('div', { class: 'stack' },
      el('div', { class: 'row between wrap' },
        el('span', { class: 'muted' }, `${inv.listings.length} listing${inv.listings.length === 1 ? '' : 's'} · you would receive ${money(total)}`),
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: inv.chosenListings.size === inv.listings.length, onchange: (e) => { inv.chosenListings = new Set(e.target.checked ? inv.listings.map((l) => l.listingid) : []); render(false); } }),
          'Select all'),
      ),
      el('div', { class: 'ach-list' },
        ...inv.listings.map((l) =>
          el('label', { class: `ach listing ${inv.chosenListings.has(l.listingid) ? 'pending' : ''}` },
            el('input', { type: 'checkbox', checked: inv.chosenListings.has(l.listingid), onchange: (e) => { if (e.target.checked) inv.chosenListings.add(l.listingid); else inv.chosenListings.delete(l.listingid); render(false); } }),
            l.icon ? el('img', { src: l.icon, alt: '' }) : el('span', { class: 'ach-icon' }, icon('tag')),
            el('div', {},
              el('div', { class: 'title' }, l.name, l.pending ? el('span', { class: 'pill' }, 'Awaiting confirmation') : ''),
              el('div', { class: 'desc' }, `Buyer pays ${money(l.buyerPrice)} · you receive ${money(l.sellerPrice)}`)),
          ),
        ),
      ),
    );
  });
}

async function removeChosenListings() {
  const ids = [...inv.chosenListings];
  if (!ids.length || !confirm(`Remove ${ids.length} listing${ids.length === 1 ? '' : 's'} from the market? The items go back to your inventory.`)) return;
  const res = await act('POST', 'market/remove', { listingids: ids });
  if (res) {
    toast(`Removed ${res.removed} listing${res.removed === 1 ? '' : 's'}${res.errors.length ? ` (${res.errors.length} failed)` : ''}`, res.errors.length ? 'err' : '');
    inv.items = [];
    loadListings();
    loadInventory(true);
  }
}

// ================================================================ add account

let qrPoll = null;

function openAddDialog() {
  $('#add-error').textContent = '';
  $('#qr-box').replaceChildren();
  $('#qr-status').textContent = '';
  const acc = current();
  $('#add-username').value = acc && !acc.hasLogin ? acc.username : '';
  $('#add-dialog').showModal();
}

$('#add-close').addEventListener('click', () => {
  clearInterval(qrPoll);
  $('#add-dialog').close();
});
for (const btn of document.querySelectorAll('#add-dialog .tab')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('#add-dialog .tab')) b.classList.toggle('active', b === btn);
    for (const p of document.querySelectorAll('#add-dialog .pane')) p.classList.toggle('hidden', p.id !== btn.dataset.pane);
  });
}

function accountAdded(username) {
  $('#add-dialog').close();
  selectAccount(username);
}

$('#pw-pane').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#add-error').textContent = '';
  try {
    const acc = await api('POST', '/api/accounts', {
      username: $('#add-username').value,
      password: $('#add-password').value,
      sharedSecret: $('#add-secret').value || undefined,
    });
    $('#add-password').value = '';
    $('#add-secret').value = '';
    accountAdded(acc.username);
  } catch (err) {
    $('#add-error').textContent = err.message;
  }
});

$('#qr-start').addEventListener('click', async () => {
  $('#add-error').textContent = '';
  clearInterval(qrPoll);
  try {
    const { id, qrDataUrl } = await api('POST', '/api/accounts/qr');
    $('#qr-box').replaceChildren(el('img', { src: qrDataUrl, alt: 'Steam login QR code' }));
    $('#qr-status').textContent = 'Waiting for scan…';
    qrPoll = setInterval(async () => {
      try {
        const s = await api('GET', `/api/accounts/qr/${id}`);
        if (s.status === 'done') {
          clearInterval(qrPoll);
          accountAdded(s.username);
        } else if (s.status === 'failed') {
          clearInterval(qrPoll);
          $('#qr-box').replaceChildren();
          $('#qr-status').textContent = '';
          $('#add-error').textContent = s.error || 'Login failed';
        }
      } catch (err) {
        clearInterval(qrPoll);
        $('#add-error').textContent = err.message;
      }
    }, 2000);
  } catch (err) {
    $('#add-error').textContent = err.message;
  }
});

// ================================================================ boot

hydrateIcons();
api('GET', '/api/auth/me')
  .then((r) => (r.authenticated ? showApp() : showLogin()))
  .catch(showLogin);
