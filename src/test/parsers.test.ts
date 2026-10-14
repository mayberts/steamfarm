import assert from 'node:assert/strict';
import { test } from 'node:test';
import Schema from 'steam-user/protobufs/generated/_load.js';
import { parseSchema } from '../achievements';
import { parseBadgePage } from '../badges';

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
