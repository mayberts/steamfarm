'use strict';

// ---------------------------------------------------------------- helpers

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

const fmtTime = (ms) => new Date(ms).toLocaleTimeString();
const fmtHours = (min) => `${(min / 60).toFixed(1)} h`;
function fmtIn(ms) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const STATUS_LABEL = {
  stopped: 'Stopped',
  connecting: 'Connecting',
  awaiting_guard: 'Needs Steam Guard code',
  online: 'Online',
  error: 'Error',
};

// ---------------------------------------------------------------- state

let state = { accounts: [], log: [] };
let selected = null; // username
let renderedFor = null; // username the static panels were built for
let games = []; // owned games of the selected account
let gamesFilter = '';
let onlyIdling = false;
let pollTimer = null;

// ---------------------------------------------------------------- auth

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

// ---------------------------------------------------------------- polling

async function refresh() {
  try {
    state = await api('GET', '/api/state');
  } catch {
    return;
  }
  if (!selected || !state.accounts.some((a) => a.username === selected)) {
    selected = state.accounts[0]?.username ?? null;
  }
  renderTabs();
  renderMain();
}

function current() {
  return state.accounts.find((a) => a.username === selected) || null;
}

function renderTabs() {
  const nav = $('#account-tabs');
  nav.replaceChildren(
    ...state.accounts.map((a) =>
      el(
        'button',
        {
          class: a.username === selected ? 'active' : '',
          onclick: () => {
            selected = a.username;
            renderTabs();
            renderMain();
          },
        },
        el('span', { class: `dot ${a.status}` }),
        a.personaName || a.username,
      ),
    ),
  );
}

// ---------------------------------------------------------------- main view

function renderMain() {
  const main = $('#main');
  const acc = current();
  if (!acc) {
    renderedFor = null;
    main.replaceChildren(
      el('div', { class: 'card' },
        el('h2', {}, 'No accounts yet'),
        el('p', { class: 'muted' }, 'Add a Steam account to start idling games, farming trading cards and managing achievements.'),
        el('button', { onclick: openAddDialog }, 'Add account'),
      ),
    );
    return;
  }
  if (renderedFor !== acc.username) {
    buildPanels(acc);
    renderedFor = acc.username;
    freeSettingsFilled = false;
    games = [];
    if (acc.status === 'online') loadGames();
  }
  updatePanels(acc);
}

/** Build the parts of the page that contain inputs; rebuilt only when switching accounts. */
function buildPanels(acc) {
  const s = acc.settings;
  const main = $('#main');
  main.replaceChildren(
    el('div', { class: 'grid2' },
      el('section', { class: 'card stack' },
        el('div', { id: 'profile' }),
        el('form', { id: 'guard-form', class: 'row hidden', onsubmit: submitGuard },
          el('input', { id: 'guard-code', placeholder: 'Steam Guard code', autocomplete: 'one-time-code' }),
          el('button', { type: 'submit' }, 'Submit'),
        ),
        el('div', { class: 'row wrap', id: 'account-actions' }),
      ),
      el('section', { class: 'card stack' },
        el('h3', {}, 'Settings'),
        el('div', { class: 'row wrap' },
          el('label', {}, 'Online status',
            el('select', { id: 'set-persona' },
              ...['online', 'away', 'invisible', 'offline'].map((v) =>
                el('option', { value: v, selected: s.personaState === v }, v[0].toUpperCase() + v.slice(1))),
            ),
          ),
          el('label', { class: 'grow' }, 'Custom "playing" status (optional)',
            el('input', { id: 'set-status', value: s.customStatus, maxlength: '64', placeholder: 'e.g. AFK' }),
          ),
        ),
        el('label', {}, 'Shared secret for automatic 2FA (optional)',
          el('input', { id: 'set-secret', type: 'password', autocomplete: 'off', placeholder: acc.hasSharedSecret ? 'Saved (leave blank to keep)' : 'Not set' }),
        ),
        el('label', { class: 'check' }, el('input', { id: 'set-autostart', type: 'checkbox', checked: s.autoStart }), 'Log in automatically when the container starts'),
        el('div', { class: 'row' },
          el('button', { onclick: saveSettings }, 'Save settings'),
          el('span', { id: 'settings-msg', class: 'muted small' }),
        ),
      ),
    ),
    el('div', { class: 'grid2' },
      el('section', { class: 'card stack' },
        el('div', { class: 'row between' }, el('h3', {}, 'Card farming'), el('div', { id: 'farm-buttons', class: 'row' })),
        el('div', { id: 'farm-status', class: 'muted' }),
        el('div', { class: 'row wrap' },
          el('label', {}, 'Games at once', el('input', { id: 'farm-max', type: 'number', min: '1', max: '32', value: s.farm.maxConcurrent, class: 'w90' })),
          el('label', {}, 'Re-check every (min)', el('input', { id: 'farm-interval', type: 'number', min: '5', max: '240', value: s.farm.checkIntervalMin, class: 'w90' })),
          el('label', { class: 'grow' }, 'Never farm (app IDs, comma separated)', el('input', { id: 'farm-blacklist', value: s.farm.blacklist.join(', ') })),
        ),
        el('label', { class: 'check' }, el('input', { id: 'farm-auto', type: 'checkbox', checked: s.farm.autoStart }), 'Start farming automatically after login'),
        el('div', { id: 'farm-games' }),
      ),
      el('section', { class: 'card stack' },
        el('h3', {}, 'Achievement unlocker'),
        el('div', { id: 'unlocker-status', class: 'muted' }),
        el('h3', {}, 'Activity'),
        el('div', { id: 'account-log', class: 'log' }),
      ),
    ),
    el('section', { class: 'card stack' },
      el('div', { class: 'row between wrap' },
        el('h3', {}, 'Free games'),
        el('div', { class: 'row' },
          el('button', { class: 'secondary', onclick: checkFreeGames }, 'Check now'),
        ),
      ),
      el('div', { id: 'free-status', class: 'muted' }),
      el('div', { id: 'free-list', class: 'stack' }),
      el('label', { class: 'check' },
        el('input', { id: 'free-auto', type: 'checkbox', checked: acc.freeGames.autoClaim, onchange: (e) => act('PUT', 'settings', { autoClaimFree: e.target.checked }) }),
        'Automatically claim free games for this account'),
      el('details', {},
        el('summary', { class: 'muted' }, 'Alert settings (all accounts)'),
        el('div', { class: 'stack' },
          el('div', { class: 'row wrap' },
            el('label', { class: 'check' }, el('input', { id: 'free-enabled', type: 'checkbox' }), 'Check for free games'),
            el('label', {}, 'Every (min)', el('input', { id: 'free-interval', type: 'number', min: '15', max: '1440', class: 'w90' })),
          ),
          el('label', {}, 'Alert webhook (Discord webhook or ntfy topic URL, optional)',
            el('input', { id: 'free-webhook', placeholder: 'https://discord.com/api/webhooks/… or https://ntfy.sh/my-topic' })),
          el('div', { class: 'row' },
            el('button', { onclick: saveFreeSettings }, 'Save'),
            el('button', { class: 'secondary', onclick: testWebhook }, 'Send test alert'),
            el('span', { id: 'free-msg', class: 'muted small' }),
          ),
        ),
      ),
    ),
    el('section', { class: 'card' },
      el('div', { class: 'row between wrap' },
        el('h3', {}, 'Games'),
        el('div', { class: 'row wrap' },
          el('span', { id: 'idle-count', class: 'pill' }),
          el('input', { id: 'game-filter', placeholder: 'Search games', value: gamesFilter, oninput: (e) => { gamesFilter = e.target.value; renderGames(); } }),
          el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: onlyIdling, onchange: (e) => { onlyIdling = e.target.checked; renderGames(); } }), 'Idling only'),
          el('button', { class: 'secondary', onclick: () => setIdle([]) }, 'Stop all'),
          el('button', { class: 'secondary', onclick: () => loadGames(true) }, 'Refresh'),
        ),
      ),
      el('p', { class: 'muted small' }, 'Tick games to boost their playtime. Up to 32 games can run at once, shared with card farming and the custom status.'),
      el('div', { id: 'games', class: 'games' }),
    ),
  );
}

function updatePanels(acc) {
  // Profile and status
  const statusClass = acc.status === 'online' ? 'ok' : acc.status === 'error' ? 'error' : acc.status === 'stopped' ? 'muted' : 'warn';
  $('#profile').replaceChildren(
    el('div', { class: 'profile' },
      acc.avatarUrl ? el('img', { src: acc.avatarUrl, alt: '' }) : el('img', { alt: '' }),
      el('div', {},
        el('h2', {}, acc.personaName || acc.username),
        el('div', { class: 'muted small' }, acc.username, acc.steamId ? ` · ${acc.steamId}` : ''),
        el('div', { class: `status-line ${statusClass}` }, STATUS_LABEL[acc.status], acc.statusMessage ? ` · ${acc.statusMessage}` : ''),
        acc.playingBlocked ? el('div', { class: 'warn small' }, 'Paused while you play on another device') : null,
        acc.status === 'online' ? el('div', { class: 'muted small' }, `Running ${acc.playing.length} game(s)`) : null,
      ),
    ),
  );
  $('#guard-form').classList.toggle('hidden', acc.status !== 'awaiting_guard');

  const running = acc.status !== 'stopped' && acc.status !== 'error';
  $('#account-actions').replaceChildren(...[
    running
      ? el('button', { class: 'secondary', onclick: () => act('POST', 'stop') }, 'Log off')
      : el('button', { onclick: () => act('POST', 'start'), disabled: !acc.hasLogin }, 'Log in'),
    !acc.hasLogin ? el('button', { class: 'secondary', onclick: openAddDialog }, 'Re-authenticate') : null,
    el('button', { class: 'danger', onclick: removeAccount }, 'Remove'),
  ].filter(Boolean));

  // Farming
  const f = acc.farming;
  $('#farm-buttons').replaceChildren(
    f.active
      ? el('button', { class: 'secondary', onclick: () => act('POST', 'farm/stop') }, 'Stop')
      : el('button', { onclick: saveFarmAndStart, disabled: acc.status !== 'online' }, 'Start farming'),
  );
  $('#farm-status').textContent = f.active
    ? `${f.message || 'Checking badges…'}${f.lastCheck ? ` · last checked ${fmtTime(f.lastCheck)}` : ''}`
    : f.message || 'Idles games that still have trading card drops and stops when none are left.';
  $('#farm-games').replaceChildren(
    f.active && f.games.length
      ? el('table', {},
          el('tr', {}, el('th', {}, 'Game'), el('th', {}, 'Drops left'), el('th', {}, 'Hours')),
          ...f.games.map((g, i) =>
            el('tr', { class: i < acc.settings.farm.maxConcurrent ? '' : 'muted' },
              el('td', {}, g.name), el('td', {}, g.dropsRemaining), el('td', {}, g.hoursPlayed))),
        )
      : '',
  );

  updateFreeGames(acc);

  // Unlocker
  const u = acc.unlocker;
  $('#unlocker-status').replaceChildren(
    u
      ? el('div', { class: 'row between wrap' },
          el('span', {}, `App ${u.appid}: ${u.remaining} left, next in ${fmtIn(u.nextAt)}${u.idle ? ' (idling)' : ''}`),
          el('button', { class: 'secondary', onclick: () => act('DELETE', 'unlocker') }, 'Stop'),
        )
      : 'Not running. Open a game\'s achievements to start it.',
  );

  // Log (fetched separately; cheap enough every poll)
  api('GET', `/api/accounts/${encodeURIComponent(acc.username)}/log`)
    .then((entries) => {
      const box = $('#account-log');
      if (!box) return;
      const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
      box.replaceChildren(...entries.map((e) => el('div', { class: e.level === 'info' ? '' : e.level === 'warn' ? 'warn' : 'error' }, `${fmtTime(e.time)}  ${e.message}`)));
      if (stick) box.scrollTop = box.scrollHeight;
    })
    .catch(() => {});

  if (acc.status === 'online' && games.length === 0 && !loadingGames) loadGames();
  updateIdleCount(acc);
}

let freeState = null;
let freeSettingsFilled = false;

async function updateFreeGames(acc) {
  try {
    freeState = await api('GET', '/api/free-games');
  } catch {
    return;
  }
  const status = $('#free-status');
  if (!status) return;
  status.textContent = `${freeState.message || 'Not checked yet'}${freeState.lastCheck ? ` · last checked ${fmtTime(freeState.lastCheck)}` : ''}`;
  const claimed = new Set(acc.freeGames.claimed);
  $('#free-list').replaceChildren(
    ...freeState.promos.map((p) =>
      el('div', { class: 'row between' },
        el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.name),
        claimed.has(p.key)
          ? el('span', { class: 'pill' }, 'In library')
          : el('button', { disabled: acc.status !== 'online', onclick: () => claimFree(p.key) }, 'Claim'),
      ),
    ),
  );
  if (!freeSettingsFilled) {
    freeSettingsFilled = true;
    $('#free-enabled').checked = freeState.settings.enabled;
    $('#free-interval').value = freeState.settings.intervalMin;
    $('#free-webhook').value = freeState.settings.webhookUrl;
  }
}

async function claimFree(key) {
  await act('POST', 'free-games/claim', { key });
}

async function checkFreeGames() {
  $('#free-status').textContent = 'Checking…';
  try {
    await api('POST', '/api/free-games/check');
  } catch (err) {
    alert(err.message);
  }
  refresh();
}

function freeMsg(text) {
  const m = $('#free-msg');
  if (!m) return;
  m.textContent = text;
  setTimeout(() => { if (m.textContent === text) m.textContent = ''; }, 3000);
}

async function saveFreeSettings() {
  try {
    await api('PUT', '/api/free-games/settings', {
      enabled: $('#free-enabled').checked,
      intervalMin: Number($('#free-interval').value),
      webhookUrl: $('#free-webhook').value,
    });
    freeMsg('Saved');
  } catch (err) {
    freeMsg(err.message);
  }
}

async function testWebhook() {
  try {
    await saveFreeSettings();
    await api('POST', '/api/free-games/test-webhook');
    freeMsg('Test alert sent');
  } catch (err) {
    freeMsg(err.message);
  }
}

function updateIdleCount(acc) {
  const node = $('#idle-count');
  if (node) node.textContent = `Booster: ${acc.settings.idleGames.length} game(s)`;
}

// ---------------------------------------------------------------- actions

async function act(method, path, body) {
  const acc = current();
  if (!acc) return;
  try {
    await api(method, `/api/accounts/${encodeURIComponent(acc.username)}/${path}`, body);
  } catch (err) {
    alert(err.message);
  }
  refresh();
}

async function submitGuard(e) {
  e.preventDefault();
  const code = $('#guard-code').value.trim();
  if (!code) return;
  $('#guard-code').value = '';
  await act('POST', 'guard', { code });
}

async function saveSettings() {
  const body = {
    personaState: $('#set-persona').value,
    customStatus: $('#set-status').value,
    autoStart: $('#set-autostart').checked,
  };
  const secret = $('#set-secret').value.trim();
  if (secret) body.sharedSecret = secret;
  await act('PUT', 'settings', body);
  $('#set-secret').value = '';
  $('#settings-msg').textContent = 'Saved';
  setTimeout(() => { const m = $('#settings-msg'); if (m) m.textContent = ''; }, 2000);
}

async function saveFarmAndStart() {
  const blacklist = $('#farm-blacklist').value.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  await act('PUT', 'settings', {
    farm: {
      maxConcurrent: Number($('#farm-max').value),
      checkIntervalMin: Number($('#farm-interval').value),
      blacklist,
      autoStart: $('#farm-auto').checked,
    },
  });
  await act('POST', 'farm/start');
}

async function removeAccount() {
  const acc = current();
  if (!acc || !confirm(`Remove ${acc.username}? Its saved login will be deleted.`)) return;
  await act('DELETE', '');
  renderedFor = null;
}

// ---------------------------------------------------------------- games

let loadingGames = false;
async function loadGames(force = false) {
  const acc = current();
  if (!acc || acc.status !== 'online') return;
  loadingGames = true;
  const box = $('#games');
  if (box && !games.length) box.replaceChildren(el('div', { class: 'muted' }, 'Loading games…'));
  try {
    games = await api('GET', `/api/accounts/${encodeURIComponent(acc.username)}/games${force ? '?refresh=1' : ''}`);
    renderGames();
  } catch (err) {
    if (box) box.replaceChildren(el('div', { class: 'error' }, err.message));
  } finally {
    loadingGames = false;
  }
}

function renderGames() {
  const acc = current();
  const box = $('#games');
  if (!acc || !box) return;
  const idle = new Set(acc.settings.idleGames);
  const q = gamesFilter.trim().toLowerCase();
  const list = games.filter((g) => (!onlyIdling || idle.has(g.appid)) && (!q || g.name.toLowerCase().includes(q) || String(g.appid) === q));
  if (!list.length) {
    box.replaceChildren(el('div', { class: 'muted' }, games.length ? 'No matching games.' : acc.status === 'online' ? 'No games found.' : 'Log in to see games.'));
    return;
  }
  box.replaceChildren(
    ...list.slice(0, 500).map((g) =>
      el('div', { class: 'game' },
        el('input', {
          type: 'checkbox',
          checked: idle.has(g.appid),
          title: 'Idle this game',
          onchange: (e) => toggleIdle(g.appid, e.target.checked),
        }),
        g.icon ? el('img', { src: g.icon, alt: '', loading: 'lazy' }) : el('img', { alt: '' }),
        el('span', { class: 'name', title: `${g.name} (${g.appid})` }, g.name),
        el('span', { class: 'hours' }, fmtHours(g.playtimeMinutes)),
        el('button', { class: 'secondary', onclick: () => openAchievements(g) }, 'Achievements'),
      ),
    ),
  );
}

async function toggleIdle(appid, on) {
  const acc = current();
  const set = new Set(acc.settings.idleGames);
  if (on) set.add(appid);
  else set.delete(appid);
  if (set.size > 32) {
    alert('Steam allows at most 32 games at once.');
    renderGames();
    return;
  }
  await setIdle([...set]);
}

async function setIdle(appids) {
  await act('PUT', 'idle', { appids });
  renderGames();
}

// ---------------------------------------------------------------- achievements

let achGame = null;
let achList = [];

async function openAchievements(game) {
  achGame = game;
  achList = [];
  $('#ach-title').textContent = `${game.name} · achievements`;
  $('#ach-error').textContent = '';
  $('#ach-filter').value = '';
  $('#ach-list').replaceChildren(el('div', { class: 'muted' }, 'Loading…'));
  $('#ach-dialog').showModal();
  await loadAchievements();
}

async function loadAchievements() {
  const acc = current();
  try {
    const res = await api('GET', `/api/accounts/${encodeURIComponent(acc.username)}/achievements/${achGame.appid}`);
    achList = res.achievements;
    renderAchievements();
  } catch (err) {
    $('#ach-list').replaceChildren();
    $('#ach-error').textContent = err.message;
  }
}

function renderAchievements() {
  const q = $('#ach-filter').value.trim().toLowerCase();
  const list = achList.filter((a) => !q || a.displayName.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  const unlocked = achList.filter((a) => a.unlocked).length;
  $('#ach-title').textContent = `${achGame.name} · ${unlocked}/${achList.length} achievements`;
  if (!achList.length) {
    $('#ach-list').replaceChildren(el('div', { class: 'muted' }, 'This game has no achievements.'));
    return;
  }
  $('#ach-list').replaceChildren(
    ...list.map((a) =>
      el('div', { class: 'ach' },
        el('img', { src: (a.unlocked ? a.icon : a.iconGray) || a.icon, alt: '', loading: 'lazy' }),
        el('div', {},
          el('div', {}, a.displayName, a.protected ? el('span', { class: 'pill', title: 'Only the game server can change this one' }, ' protected') : ''),
          el('div', { class: 'desc' },
            a.description || (a.hidden ? 'Hidden achievement' : ''),
            a.percent !== undefined ? ` · ${a.percent.toFixed(1)}% of players` : '',
            a.unlocked && a.unlockTime ? ` · unlocked ${new Date(a.unlockTime * 1000).toLocaleDateString()}` : ''),
        ),
        el('button', {
          class: a.unlocked ? 'secondary' : '',
          disabled: a.protected,
          onclick: () => changeAchievements({ [a.name]: !a.unlocked }),
        }, a.unlocked ? 'Lock' : 'Unlock'),
      ),
    ),
  );
}

async function changeAchievements(changes) {
  const acc = current();
  $('#ach-error').textContent = '';
  try {
    await api('POST', `/api/accounts/${encodeURIComponent(acc.username)}/achievements/${achGame.appid}`, { changes });
  } catch (err) {
    $('#ach-error').textContent = err.message;
  }
  await loadAchievements();
}

$('#ach-filter').addEventListener('input', renderAchievements);
$('#ach-close').addEventListener('click', () => $('#ach-dialog').close());
$('#ach-unlock-all').addEventListener('click', () => {
  const changes = Object.fromEntries(achList.filter((a) => !a.unlocked && !a.protected).map((a) => [a.name, true]));
  if (Object.keys(changes).length && confirm(`Unlock ${Object.keys(changes).length} achievement(s) now?`)) changeAchievements(changes);
});
$('#ach-lock-all').addEventListener('click', () => {
  const changes = Object.fromEntries(achList.filter((a) => a.unlocked && !a.protected).map((a) => [a.name, false]));
  if (Object.keys(changes).length && confirm(`Lock ${Object.keys(changes).length} achievement(s)?`)) changeAchievements(changes);
});
$('#unl-start').addEventListener('click', async () => {
  const acc = current();
  $('#ach-error').textContent = '';
  try {
    const res = await api('POST', `/api/accounts/${encodeURIComponent(acc.username)}/unlocker`, {
      appid: achGame.appid,
      minDelaySec: Number($('#unl-min').value) * 60,
      maxDelaySec: Number($('#unl-max').value) * 60,
      idle: $('#unl-idle').checked,
    });
    $('#ach-dialog').close();
    alert(`Unlocker started: ${res.queued} achievement(s) queued.`);
    refresh();
  } catch (err) {
    $('#ach-error').textContent = err.message;
  }
});

// ---------------------------------------------------------------- add account

let qrPoll = null;

function openAddDialog() {
  $('#add-error').textContent = '';
  $('#qr-box').replaceChildren();
  $('#qr-status').textContent = '';
  const acc = current();
  $('#add-username').value = acc && !acc.hasLogin ? acc.username : '';
  $('#add-dialog').showModal();
}

$('#add-account-btn').addEventListener('click', openAddDialog);
$('#add-close').addEventListener('click', () => {
  clearInterval(qrPoll);
  $('#add-dialog').close();
});
for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.tab-btn')) b.classList.toggle('active', b === btn);
    for (const p of document.querySelectorAll('#add-dialog .pane')) p.classList.toggle('hidden', p.id !== btn.dataset.pane);
  });
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
    selected = acc.username;
    renderedFor = null;
    $('#add-dialog').close();
    refresh();
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
          selected = s.username;
          renderedFor = null;
          $('#add-dialog').close();
          refresh();
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

// ---------------------------------------------------------------- boot

api('GET', '/api/auth/me')
  .then((r) => (r.authenticated ? showApp() : showLogin()))
  .catch(showLogin);
