import assert from 'node:assert/strict';
import { test } from 'node:test';
import Schema from 'steam-user/protobufs/generated/_load.js';
import { parseSchema } from '../achievements';
import { describeBadgePage, fetchBadgeGames, parseBadgePage } from '../badges';
import { parseFreeSearch } from '../freegames';

test('parseBadgePage finds games with drops, names, hours and pages', () => {
  const html = `
    <script>g_steamID = "76561198000000000";</script>
    <div class="badge_row is_link">
      <a class="badge_row_overlay" href="https://steamcommunity.com/profiles/1/gamecards/440/"></a>
      <div class="badge_title">
        Team Fortress 2&nbsp;<span class="badge_view_details">View details</span>
      </div>
      <div class="badge_title_stats_playtime">&nbsp;1,234.5 hrs on record</div>
      <span class="progress_info_bold">3 card drops remaining</span>
    </div>
    <div class="badge_row is_link">
      <a class="badge_row_overlay" href="https://steamcommunity.com/profiles/1/gamecards/730/"></a>
      <div class="badge_title">Counter-Strike 2 &amp; Friends</div>
      <span class="progress_info_bold">No card drops remaining</span>
    </div>
    <div class="badge_row is_link"><div class="badge_title">Community badge</div></div>
    <a class="pagelink" href="?p=2">2</a><a class="pagelink" href="?p=3">3</a>`;
  const page = parseBadgePage(html);
  assert.equal(page.loggedIn, true);
  assert.equal(page.totalPages, 3);
  assert.deepEqual(page.games, [
    { appid: 440, name: 'Team Fortress 2', dropsRemaining: 3, hoursPlayed: 1234.5 },
    { appid: 730, name: 'Counter-Strike 2 & Friends', dropsRemaining: 0, hoursPlayed: 0 },
  ]);
});

test('parseBadgePage reads the badge_row_inner layout with card_drop_info ids', () => {
  const html = `
    <script>g_steamID = "76561198000000000";</script>
    <div class="badge_row is_link">
      <a class="badge_row_overlay" href="https://steamcommunity.com/id/me/gamecards/570"></a>
      <div class="badge_row_inner">
        <div class="badge_title_row">
          <div class="badge_title">
            Dota&nbsp;2&nbsp;<span class="badge_view_details">View details</span>
          </div>
        </div>
        <div class="badge_title_stats">
          <div class="badge_title_stats_content">
            <div class="badge_title_stats_playtime">&nbsp;12.5 hrs on record</div>
            <div class="badge_title_stats_drops">
              <span class="progress_info_bold">2 card drops remaining</span>
              <div class="card_drop_info_dialog" id="card_drop_info_gamebadge_570_1_0" style="display: none;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="badge_row is_link">
      <a class="badge_row_overlay" href="https://steamcommunity.com/id/me/gamecards/730"></a>
      <div class="badge_row_inner">
        <div class="badge_title">Counter-Strike 2</div>
        <div class="badge_title_stats_content">
          <span class="progress_info_bold">No card drops remaining</span>
          <div class="card_drop_info_dialog" id="card_drop_info_gamebadge_730_1_0"></div>
        </div>
      </div>
    </div>
    <div class="badge_row is_link">
      <a class="badge_row_overlay" href="https://steamcommunity.com/id/me/badges/13"></a>
      <div class="badge_row_inner"><div class="badge_title">Years of Service</div></div>
    </div>`;
  assert.deepEqual(parseBadgePage(html).games, [
    { appid: 570, name: 'Dota 2', dropsRemaining: 2, hoursPlayed: 12.5 },
    { appid: 730, name: 'Counter-Strike 2', dropsRemaining: 0, hoursPlayed: 0 },
  ]);
});

test('describeBadgePage summarises the page without its contents', () => {
  const summary = describeBadgePage('<title>Steam Community :: me :: Badges</title><script>g_steamID = "1"; g_sessionID = "secret";</script>');
  assert.match(summary, /title "Steam Community :: me :: Badges"/);
  assert.match(summary, /g_steamID set/);
  assert.doesNotMatch(summary, /secret/);
});

test('parseBadgePage detects a logged-out page', () => {
  assert.equal(parseBadgePage('<script>g_steamID = false;</script>').loggedIn, false);
});

test('parseSchema maps bitfield stats to achievements and unlock state', () => {
  const schema = {
    '480': {
      stats: {
        '1': {
          type: '4',
          id: '1',
          bits: {
            '0': { name: 'ACH_WIN', bit: 0, display: { name: { english: 'Winner' }, desc: { english: 'Win a game' }, hidden: '0', icon: 'a.jpg', icon_gray: 'b.jpg' } },
            '1': { name: 'ACH_SECRET', bit: 1, display: { name: 'Secret', hidden: '1' }, permission: 2 },
          },
        },
        '2': { type: '1', id: '2', name: 'NumGames' },
      },
    },
  };
  const unlockTimes = new Array(32).fill(0);
  unlockTimes[1] = 1_700_000_000;
  const res = parseSchema(480, schema, [{ achievement_id: 1, unlock_time: unlockTimes }]);
  assert.equal(res.achievements.length, 2);
  const [win, secret] = res.achievements;
  assert.equal(win.name, 'ACH_WIN');
  assert.equal(win.displayName, 'Winner');
  assert.equal(win.unlocked, false);
  assert.equal(win.icon, 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/480/a.jpg');
  assert.equal(secret.unlocked, true);
  assert.equal(secret.hidden, true);
  assert.equal(secret.protected, true);
  assert.equal(res.bitfields.get(1), 0b10);
});

test('parseSchema prefers reported stat values and links progress stats', () => {
  const schema = {
    '480': {
      stats: {
        '7': { type: 'INT', name: 'GAMES_WON', permission: '0' },
        '9': { type: '1', name: 'SERVER_ONLY', permission: '2' },
        '3': {
          type: 'ACHIEVEMENTS',
          // A misleading `bit` field: the key is the bit number.
          bits: {
            '0': { name: 'ACH_A', bit: 5, display: { name: 'A' } },
            '1': { name: 'ACH_WIN_10', display: { name: 'Win 10' }, progress: { value: { operation: 'statvalue', operand1: 'GAMES_WON' }, min_val: '0', max_val: '10' } },
            '2': { name: 'ACH_SERVER', display: { name: 'Server' }, progress: { value: { operand1: 'SERVER_ONLY' }, max_val: '1' } },
          },
        },
      },
    },
  };
  // The blocks say nothing is unlocked, but the reported stat value has bit 0 set.
  const res = parseSchema(480, schema, [{ achievement_id: 3, unlock_time: [] }], [{ stat_id: 3, stat_value: 1 }]);
  const [a, win, server] = res.achievements;
  assert.equal(a.bit, 0);
  assert.equal(a.statId, 3);
  assert.equal(a.unlocked, true);
  assert.equal(res.bitfields.get(3), 1);
  assert.deepEqual(win.dependency, { statId: 7, value: 10 });
  assert.equal(win.protected, false);
  assert.equal(server.protected, true);
});

test('user stats protobufs used by the achievement manager exist', () => {
  for (const name of ['CMsgClientGetUserStats', 'CMsgClientGetUserStatsResponse', 'CMsgClientStoreUserStats2', 'CMsgClientStoreUserStatsResponse']) {
    assert.ok(Schema[name], `${name} missing`);
  }
  const buf = Schema.CMsgClientStoreUserStats2.encode({
    game_id: 480,
    settor_steam_id: '76561198000000000',
    settee_steam_id: '76561198000000000',
    crc_stats: 123,
    stats: [{ stat_id: 1, stat_value: 0xffffffff }],
  }).finish();
  const back = Schema.CMsgClientStoreUserStats2.toObject(Schema.CMsgClientStoreUserStats2.decode(buf), { longs: String });
  assert.equal(back.settee_steam_id, '76561198000000000');
  assert.equal(back.stats[0].stat_value, 0xffffffff);
});

function badgeHtml(appid: number, drops: number, pages: number): string {
  const links = Array.from({ length: pages }, (_, i) => `<a class="pagelink" href="?p=${i + 1}">${i + 1}</a>`).join('');
  return `<script>g_steamID = "1";</script>
    <div class="badge_row is_link"><a href="https://steamcommunity.com/id/me/gamecards/${appid}/"></a>
    <div class="badge_title">Game ${appid}</div><span class="progress_info_bold">${drops} card drops remaining</span></div>${links}`;
}

async function withFetch(handler: (url: string) => Response, fn: () => Promise<void>): Promise<string[]> {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    return handler(url);
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return seen;
}

test('fetchBadgeGames follows the custom-URL redirect and keeps paging there', async () => {
  let drops: Awaited<ReturnType<typeof fetchBadgeGames>> = [];
  const seen = await withFetch(
    (url) => {
      if (url.includes('/profiles/')) {
        // Steam drops the query string on this redirect.
        return new Response(null, { status: 302, headers: { location: 'https://steamcommunity.com/id/me/badges/' } });
      }
      const page = new URL(url).searchParams.get('p') ?? '1';
      return new Response(page === '1' ? badgeHtml(10, 2, 2) : badgeHtml(20, 1, 2));
    },
    async () => {
      drops = await fetchBadgeGames('765', ['steamLoginSecure=x']);
    },
  );
  assert.deepEqual(drops.map((d) => d.appid).sort(), [10, 20]);
  assert.deepEqual(seen, [
    'https://steamcommunity.com/profiles/765/badges/?l=english&p=1',
    'https://steamcommunity.com/id/me/badges/',
    'https://steamcommunity.com/id/me/badges/?l=english&p=1',
    'https://steamcommunity.com/id/me/badges/?l=english&p=2',
  ]);
});

test('fetchBadgeGames reports an expired session when sent to the login page', async () => {
  await withFetch(
    () => new Response(null, { status: 302, headers: { location: '/login/home/?goto=badges' } }),
    async () => {
      await assert.rejects(fetchBadgeGames('765', []), /session expired/);
    },
  );
});

test('parseFreeSearch keeps only 100%-off apps and packages', () => {
  const row = (attrs: string, title: string, discount: string) =>
    `<a href="https://store.steampowered.com/app/1/X/?snr=1_7_7_2300_150_1" ${attrs} onmouseover="GameHover( this, event, 'global_hover', {&quot;type&quot;:&quot;app&quot;,&quot;id&quot;:1} );" class="search_result_row ds_collapse_flag " data-search-page="1">
      <div class="responsive_search_name_combined"><div class="search_name"><span class="title">${title}</span></div>
      ${discount}</div></a>`;
  const html = [
    row('data-ds-appid="111" data-ds-itemkey="App_111" data-ds-packageid="9001"', 'Free &amp; Fun', '<div class="discount_block search_discount_block" data-price-final="0" data-discount="100"><div class="discount_pct">-100%</div></div>'),
    row('data-ds-appid="222" data-ds-itemkey="App_222"', 'Old Markup', '<div class="col search_discount responsive_secondrow"><span>-100%</span></div><div class="discount_pct">-100%</div>'),
    row('data-ds-appid="333" data-ds-packageid="9003"', 'Half Off', '<div class="search_discount_block" data-discount="50"></div>'),
    row('data-ds-appid="444" data-ds-packageid="9004"', 'Free To Play', '<div class="search_discount_block" data-discount="0"></div>'),
    row('data-ds-bundleid="55" data-ds-itemkey="Bundle_55"', 'Free Bundle', '<div class="search_discount_block" data-discount="100"></div>'),
  ].join('\n');
  assert.deepEqual(parseFreeSearch(html), [
    { key: 'sub/9001', appid: 111, packageid: 9001, name: 'Free & Fun', url: 'https://store.steampowered.com/app/1/X/' },
    { key: 'app/222', appid: 222, packageid: undefined, name: 'Old Markup', url: 'https://store.steampowered.com/app/1/X/' },
  ]);
});
