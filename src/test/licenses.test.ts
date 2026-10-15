import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appFacts,
  isAvailableApp,
  isAvailableContents,
  isAvailablePackage,
  isFreeApp,
  isFreePackage,
  isRedeemableApp,
  isRedeemablePackage,
  isWanted,
  packageFacts,
  packageName,
} from '../licenses';

// Shapes as steam-user returns them: appinfo values are strings, packageinfo values are numbers.
const f2p = appFacts(387450, { common: { name: 'Free Game', type: 'Game', releasestate: 'released' }, extended: { isfreeapp: '1' } });
const demo = appFacts(2, { common: { name: 'A Demo', type: 'Demo', releasestate: 'released', parent: '1' } });
const paid = appFacts(3, { common: { name: 'Paid', type: 'Game', releasestate: 'released' } });
const unreleased = appFacts(4, { common: { name: 'Soon', type: 'Game', releasestate: 'prerelease' }, extended: { isfreeapp: '1' } });
const dlc = appFacts(5, { common: { name: 'Free DLC', type: 'DLC', releasestate: 'released', parent: '10' } });

test('free apps are free-to-play or demos, and released', () => {
  assert.equal(f2p.type, 'game');
  assert.ok(isFreeApp(f2p) && isAvailableApp(f2p));
  assert.ok(isFreeApp(demo));
  assert.ok(!isFreeApp(paid));
  assert.ok(isFreeApp(unreleased) && !isAvailableApp(unreleased));
});

test('free packages follow billing type, status, license type and expiry', () => {
  const base = { billingtype: 12, status: 0, licensetype: 1, appids: { 0: 5 }, extended: {} };
  const now = 1_800_000_000;
  assert.ok(isFreePackage(packageFacts(1, base)) && isAvailablePackage(packageFacts(1, base), now));
  assert.ok(isFreePackage(packageFacts(1, { ...base, billingtype: 0 })));
  assert.ok(!isFreePackage(packageFacts(1, { ...base, billingtype: 1 })));
  assert.ok(!isAvailablePackage(packageFacts(1, { ...base, status: 2 }), now));
  assert.ok(!isAvailablePackage(packageFacts(1, { ...base, licensetype: 2 }), now));
  assert.ok(!isAvailablePackage(packageFacts(1, { ...base, extended: { expirytime: now - 1 } }), now));
  assert.ok(isAvailablePackage(packageFacts(1, { ...base, extended: { expirytime: now + 60 } }), now));
  assert.ok(!isAvailablePackage(packageFacts(1, { ...base, extended: { deactivated_demo: 1 } }), now));
  assert.ok(!isAvailablePackage(packageFacts(1, { ...base, appids: {} }), now));
  assert.ok(!isAvailableContents(packageFacts(1, base), [unreleased]));
  assert.ok(isAvailableContents(packageFacts(1, base), [dlc]));
  assert.ok(isAvailableContents(packageFacts(1, { ...base, billingtype: 0 }), []));
});

test('redeemable checks ownership, required games and regions', () => {
  const none = new Set<number>();
  assert.ok(isRedeemableApp(f2p, none, 'GB'));
  assert.ok(!isRedeemableApp(f2p, new Set([387450]), 'GB'));
  assert.ok(!isRedeemableApp(dlc, none, 'GB'), 'DLC needs its game');
  assert.ok(isRedeemableApp(dlc, new Set([10]), 'GB'));
  const locked = appFacts(6, { common: { type: 'Game', releasestate: 'released', restricted_countries: 'DE,AU' }, extended: { isfreeapp: '1' } });
  assert.ok(!isRedeemableApp(locked, none, 'DE'));
  assert.ok(isRedeemableApp(locked, none, 'GB'));

  const pkg = packageFacts(50, { billingtype: 12, status: 0, licensetype: 1, appids: { 0: 5 }, extended: { onlyallowrestrictedcountries: 1, restrictedcountries: 'US CA' } });
  assert.ok(!isRedeemablePackage(pkg, [dlc], new Set([10]), none, 'GB'), 'only for US/CA');
  assert.ok(isRedeemablePackage(pkg, [dlc], new Set([10]), none, 'US'));
  assert.ok(!isRedeemablePackage(pkg, [dlc], new Set([10]), new Set([50]), 'US'), 'package owned');
  assert.ok(!isRedeemablePackage(pkg, [dlc], new Set([10, 5]), none, 'US'), 'contents owned');
  assert.ok(!isRedeemablePackage(pkg, [dlc], none, none, 'US'), 'DLC game not owned');
});

test('wanted types and package names', () => {
  assert.ok(isWanted({ kind: 'app', id: 2, name: '', app: demo }, ['demo']));
  assert.ok(!isWanted({ kind: 'app', id: 2, name: '', app: demo }, ['game', 'dlc']));
  const music = appFacts(7, { common: { name: 'OST', type: 'Music' } });
  assert.ok(isWanted({ kind: 'sub', id: 1, name: '', contents: [music] }, ['music']));
  const tool = appFacts(8, { common: { name: 'SDK', type: 'Tool' } });
  assert.ok(isWanted({ kind: 'app', id: 8, name: '', app: tool }, ['other']));
  assert.equal(packageName(packageFacts(9, { appids: { 0: 3, 1: 7 } }), [music, paid]), 'Paid (+1 more)');
  assert.equal(packageName(packageFacts(9, { appids: { 0: 7 } }), [music]), 'OST');
});
