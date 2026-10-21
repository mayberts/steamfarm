import path from 'node:path';
import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import { config } from './config';
import { Logger } from './log';
import { AccountRecord, FreePromo, PersonaStateName, store } from './store';
import { DropInfo, fetchBadgeGames } from './badges';
import { fetchAppDetails, pickFreePackage } from './freegames';
import {
  ACTIVATION_LIMIT,
  ACTIVATION_PERIOD_MS,
  FreeLicenseCandidate,
  isRedeemableApp,
  isRedeemablePackage,
  isWanted,
  LICENSE_CATEGORIES,
} from './licenses';
import { productInfo } from './licensewatch';
import {
  CURRENCIES,
  fetchInventory,
  fetchListings,
  InventoryItem,
  Listing,
  MAX_BUYER_PRICE,
  MIN_BUYER_PRICE,
  priceOverview,
  PriceInfo,
  removeListing,
  sellItem,
  SellResult,
} from './market';
import { getGlobalPercentages, getUserStats, setAchievements, UserStats } from './achievements';

export type BotStatus = 'stopped' | 'connecting' | 'awaiting_guard' | 'online' | 'error';

export interface OwnedGame {
  appid: number;
  name: string;
  playtimeMinutes: number;
  icon: string;
}

const PERSONA_STATES: Record<PersonaStateName, number> = {
  offline: SteamUser.EPersonaState.Offline,
  online: SteamUser.EPersonaState.Online,
  away: SteamUser.EPersonaState.Away,
  invisible: SteamUser.EPersonaState.Invisible,
};

// Fatal logon errors after which retrying with the same credentials is pointless.
const NEEDS_REAUTH = new Set([
  SteamUser.EResult.InvalidPassword,
  SteamUser.EResult.AccessDenied,
  SteamUser.EResult.Expired,
  SteamUser.EResult.Revoked,
  SteamUser.EResult.AccountLoginDeniedNeedTwoFactor,
  SteamUser.EResult.InvalidLoginAuthCode,
  SteamUser.EResult.TwoFactorCodeMismatch,
]);

const RECONNECT_DELAY_MS = 5 * 60_000;
const WEB_SESSION_MAX_AGE_MS = 60 * 60_000;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * Math.max(0, max - min);
}

export class Bot {
  readonly log: Logger;
  status: BotStatus = 'stopped';
  statusMessage = '';
  personaName = '';
  avatarUrl = '';
  /** Steam reports another session is playing a game, so ours is paused. */
  playingBlocked = false;
  guard: { domain: string | null; lastCodeWrong: boolean } | null = null;
  farmGames: DropInfo[] = [];
  farmLastCheck = 0;
  farmMessage = '';

  private client: any = null;
  private guardCallback: ((code: string) => void) | null = null;
  private webCookies: string[] = [];
  private webSessionAt = 0;
  private ownedGames: OwnedGame[] | null = null;
  private ownedGamesAt = 0;
  /** Name and type of apps seen in owned packages, from PICS. */
  private appMeta = new Map<number, { name: string; type: string }>();
  /** Bumped whenever a claim adds to the library, so the UI knows to reload it. */
  libraryVersion = 0;
  private inventoryCache: InventoryItem[] | null = null;
  private inventoryAt = 0;
  /** The current or last market selling run, shown in the UI. */
  sellJob: { running: boolean; total: number; done: number; listed: number; failed: number; needsConfirmation: number; errors: string[]; finishedAt: number } | null = null;
  /** When each app currently sent to Steam started being played (epoch ms). */
  private idleSince = new Map<number, number>();
  private farmTimer: NodeJS.Timeout | null = null;
  private unlockTimer: NodeJS.Timeout | null = null;
  private licenseTimer: NodeJS.Timeout | null = null;
  /** App IDs in each owned package, filled lazily from PICS. */
  private licenseApps = new Map<number, number[]>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingPassword: string | null = null;

  constructor(public account: AccountRecord) {
    this.log = new Logger(account.username);
  }

  get username(): string {
    return this.account.username;
  }

  get playing(): number[] {
    return this.currentGames().filter((g): g is number => typeof g === 'number');
  }

  // ---------------------------------------------------------------- lifecycle

  /** Log in. `password` is only needed when no refresh token is stored. */
  start(password?: string): void {
    if (this.client) return;
    if (!this.account.refreshToken && !password) {
      this.setStatus('error', 'No saved login; re-add the account with its password or QR code');
      return;
    }
    this.clearReconnect();
    this.pendingPassword = password ?? null;

    const client = new SteamUser({
      dataDirectory: path.join(config.dataDir, 'steam-user'),
      autoRelogin: true,
      renewRefreshTokens: true,
    });
    this.client = client;
    this.attachHandlers(client);

    this.setStatus('connecting', 'Connecting to Steam');
    if (this.account.refreshToken) {
      client.logOn({ refreshToken: this.account.refreshToken, machineName: 'steamfarm' });
    } else {
      const details: Record<string, unknown> = {
        accountName: this.account.username,
        password,
        machineName: 'steamfarm',
      };
      if (this.account.sharedSecret) details.twoFactorCode = SteamTotp.generateAuthCode(this.account.sharedSecret);
      client.logOn(details);
    }
  }

  stop(message = 'Stopped'): void {
    this.clearReconnect();
    this.idleSince.clear();
    this.stopFarmTimer();
    this.stopUnlockTimer();
    this.stopLicenseTimer();
    if (this.client) {
      const client = this.client;
      this.client = null;
      client.removeAllListeners();
      client.on('error', () => {});
      try {
        client.logOff();
      } catch {
        // already disconnected
      }
    }
    this.guard = null;
    this.guardCallback = null;
    this.setStatus('stopped', message);
  }

  submitGuardCode(code: string): void {
    if (!this.guardCallback) throw new Error('Steam is not waiting for a code');
    const cb = this.guardCallback;
    this.guardCallback = null;
    this.guard = null;
    this.setStatus('connecting', 'Checking code');
    cb(code.trim());
  }

  private attachHandlers(client: any): void {
    client.on('steamGuard', (domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
      if (this.account.sharedSecret && !lastCodeWrong) {
        callback(SteamTotp.generateAuthCode(this.account.sharedSecret));
        return;
      }
      this.guardCallback = callback;
      this.guard = { domain, lastCodeWrong };
      const where = domain ? `email code sent to ${domain}` : 'Steam Guard mobile code (or approve the login in the Steam app)';
      this.setStatus('awaiting_guard', lastCodeWrong ? `Wrong code. Enter the ${where}` : `Enter the ${where}`);
    });

    client.on('refreshToken', (token: string) => {
      this.account.refreshToken = token;
      this.pendingPassword = null;
      store.save();
      this.log.info('Saved new login token');
    });

    client.on('loggedOn', () => {
      this.guard = null;
      this.guardCallback = null;
      this.account.steamId = client.steamID.getSteamID64();
      store.save();
      this.setStatus('online', 'Logged in');
      client.setPersona(PERSONA_STATES[this.account.personaState]);
      this.applyGames();
      if (this.account.farming || this.account.farm.autoStart) this.startFarming();
      if (this.account.unlocker) this.scheduleUnlock();
      this.scheduleLicense(10_000);
    });

    client.on('user', (sid: any, user: any) => {
      if (client.steamID && sid.getSteamID64() === client.steamID.getSteamID64()) {
        this.personaName = user.player_name ?? this.personaName;
        if (user.avatar_url_medium) this.avatarUrl = user.avatar_url_medium;
      }
    });

    client.on('webSession', (_sessionId: string, cookies: string[]) => {
      this.webCookies = cookies;
      this.webSessionAt = Date.now();
    });

    client.on('playingState', (blocked: boolean, app: number) => {
      if (blocked === this.playingBlocked) return;
      this.playingBlocked = blocked;
      if (blocked) {
        this.idleSince.clear();
        this.log.warn(`Paused: you are playing${app ? ` app ${app}` : ''} on another device`);
      } else {
        this.log.info('Other session stopped playing; resuming');
        this.applyGames();
      }
    });

    client.on('disconnected', (eresult: number, msg: string) => {
      if (this.status === 'online') this.setStatus('connecting', `Disconnected (${msg ?? eresult}); reconnecting`);
    });

    client.on('error', (err: Error & { eresult?: number }) => {
      this.client = null;
      this.stopFarmTimer();
      this.stopUnlockTimer();
      this.stopLicenseTimer();
      this.guard = null;
      this.guardCallback = null;
      if (err.eresult !== undefined && NEEDS_REAUTH.has(err.eresult)) {
        if (this.account.refreshToken && !this.pendingPassword) {
          delete this.account.refreshToken;
          store.save();
        }
        this.setStatus('error', `Login failed: ${err.message}. Re-add the account to log in again`);
        return;
      }
      this.setStatus('error', `${err.message}; retrying in 5 minutes`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.start(this.pendingPassword ?? undefined);
      }, RECONNECT_DELAY_MS);
    });
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: BotStatus, message: string): void {
    const changed = status !== this.status || message !== this.statusMessage;
    this.status = status;
    this.statusMessage = message;
    if (changed) (status === 'error' ? this.log.error(message) : this.log.info(message));
  }

  private requireOnline(): any {
    if (!this.client || this.status !== 'online') throw new Error('Account is not online');
    return this.client;
  }

  // ------------------------------------------------------------ games played

  /** Everything we want Steam to show as "playing", highest priority first. */
  private currentGames(): (number | string)[] {
    const list: (number | string)[] = [];
    const push = (g: number | string) => {
      if (!list.includes(g) && list.length < config.maxGames) list.push(g);
    };
    if (this.account.customStatus.trim()) push(this.account.customStatus.trim());
    if (this.account.unlocker?.idle) push(this.account.unlocker.appid);
    if (this.account.farming) {
      for (const g of this.farmGames.slice(0, this.account.farm.maxConcurrent)) push(g.appid);
    }
    for (const id of this.account.idleGames) push(id);
    return list;
  }

  /** Push the current game list to Steam. */
  applyGames(): void {
    if (!this.client || this.status !== 'online' || this.playingBlocked) return;
    const games = this.currentGames();
    const now = Date.now();
    const appids = new Set(games.filter((g): g is number => typeof g === 'number'));
    for (const id of appids) if (!this.idleSince.has(id)) this.idleSince.set(id, now);
    for (const id of [...this.idleSince.keys()]) if (!appids.has(id)) this.idleSince.delete(id);
    this.client.gamesPlayed(games);
  }

  /** What is being played right now, and which feature asked for it. */
  private idlingDetails() {
    if (this.status !== 'online' || this.playingBlocked) return [];
    const farming = new Set(this.account.farming ? this.farmGames.slice(0, this.account.farm.maxConcurrent).map((g) => g.appid) : []);
    return this.playing.map((appid) => ({
      appid,
      source: this.account.unlocker?.idle && this.account.unlocker.appid === appid ? 'unlocker' : farming.has(appid) ? 'farming' : 'booster',
      since: this.idleSince.get(appid) ?? Date.now(),
    }));
  }

  setFavorites(appids: number[]): void {
    this.account.favorites = [...new Set(appids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5000);
    store.save();
  }

  setIdleGames(appids: number[]): void {
    const clean = [...new Set(appids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, config.maxGames);
    this.account.idleGames = clean;
    store.save();
    this.log.info(clean.length ? `Playtime booster: idling ${clean.length} game(s)` : 'Playtime booster: stopped');
    this.applyGames();
  }

  updateSettings(patch: Partial<Pick<AccountRecord, 'personaState' | 'customStatus' | 'autoStart' | 'sharedSecret' | 'autoClaimFree'>> & {
    farm?: Partial<AccountRecord['farm']>;
    freeLicenses?: { enabled?: boolean; types?: string[] };
  }): void {
    if (patch.personaState && patch.personaState in PERSONA_STATES) this.account.personaState = patch.personaState;
    if (typeof patch.customStatus === 'string') this.account.customStatus = patch.customStatus.slice(0, 64);
    if (typeof patch.autoStart === 'boolean') this.account.autoStart = patch.autoStart;
    if (typeof patch.autoClaimFree === 'boolean') this.account.autoClaimFree = patch.autoClaimFree;
    if (typeof patch.sharedSecret === 'string') {
      if (patch.sharedSecret.trim()) this.account.sharedSecret = patch.sharedSecret.trim();
      else delete this.account.sharedSecret;
    }
    if (patch.farm) {
      const f = this.account.farm;
      if (Number.isFinite(patch.farm.maxConcurrent)) f.maxConcurrent = Math.min(config.maxGames, Math.max(1, Math.floor(patch.farm.maxConcurrent!)));
      if (Number.isFinite(patch.farm.checkIntervalMin)) f.checkIntervalMin = Math.min(240, Math.max(5, Math.floor(patch.farm.checkIntervalMin!)));
      if (Array.isArray(patch.farm.blacklist)) f.blacklist = patch.farm.blacklist.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (typeof patch.farm.autoStart === 'boolean') f.autoStart = patch.farm.autoStart;
    }
    if (patch.freeLicenses) {
      const l = this.account.freeLicenses;
      if (typeof patch.freeLicenses.enabled === 'boolean') {
        l.enabled = patch.freeLicenses.enabled;
        if (!l.enabled) l.queue = [];
      }
      if (Array.isArray(patch.freeLicenses.types)) {
        l.types = LICENSE_CATEGORIES.filter((c) => patch.freeLicenses!.types!.includes(c));
      }
    }
    store.save();
    if (this.client && this.status === 'online') {
      this.client.setPersona(PERSONA_STATES[this.account.personaState]);
      this.applyGames();
    }
  }

  // -------------------------------------------------------------- owned games

  async getOwnedGames(force = false): Promise<OwnedGame[]> {
    const client = this.requireOnline();
    if (!force && this.ownedGames && Date.now() - this.ownedGamesAt < 10 * 60_000) return this.ownedGames;
    // Count every game the account has a license for, as SteamDB does: free-to-play games it never
    // launched (free subs) and apps Steam hasn't vetted yet are left out by default.
    const res = await client.getUserOwnedApps(client.steamID, { includePlayedFreeGames: true, includeFreeSub: true, skipUnvettedApps: false });
    this.ownedGames = (res.apps ?? [])
      .map((a: any) => ({
        appid: a.appid,
        name: a.name ?? `App ${a.appid}`,
        playtimeMinutes: a.playtime_forever ?? 0,
        icon: a.img_icon_url ?? '',
      }))
      .sort((a: OwnedGame, b: OwnedGame) => a.name.localeCompare(b.name));
    // Steam leaves out free games that were never launched, which is most free licenses.
    // Add every game the account holds a license for.
    try {
      const extra = await this.licensedGames(new Set(this.ownedGames!.map((g) => g.appid)));
      if (extra.length) this.ownedGames = [...this.ownedGames!, ...extra].sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      this.log.warn(`Could not add licensed games to the library: ${(err as Error).message}`);
    }
    this.ownedGamesAt = Date.now();
    return this.ownedGames!;
  }

  private async licensedGames(have: Set<number>): Promise<OwnedGame[]> {
    const client = this.requireOnline();
    const { apps } = await this.ownership();
    const unknown = [...apps].filter((id) => !have.has(id) && !this.appMeta.has(id));
    if (unknown.length) {
      const info = await productInfo(client, unknown, []);
      for (const id of unknown) {
        const common = info.apps[id]?.common;
        this.appMeta.set(id, { name: String(common?.name ?? ''), type: String(common?.type ?? '').toLowerCase() });
      }
    }
    const games: OwnedGame[] = [];
    for (const id of apps) {
      const meta = this.appMeta.get(id);
      if (have.has(id) || meta?.type !== 'game' || !meta.name) continue;
      games.push({ appid: id, name: meta.name, playtimeMinutes: 0, icon: '' });
    }
    return games;
  }

  // ------------------------------------------------------------ card farming

  startFarming(): void {
    this.account.farming = true;
    store.save();
    this.stopFarmTimer();
    this.log.info('Card farming started');
    void this.farmTick();
  }

  stopFarming(): void {
    this.account.farming = false;
    this.farmGames = [];
    this.farmMessage = '';
    store.save();
    this.stopFarmTimer();
    this.log.info('Card farming stopped');
    this.applyGames();
  }

  private stopFarmTimer(): void {
    if (this.farmTimer) clearTimeout(this.farmTimer);
    this.farmTimer = null;
  }

  private async ensureWebSession(): Promise<string[]> {
    if (this.webCookies.length && Date.now() - this.webSessionAt < WEB_SESSION_MAX_AGE_MS) return this.webCookies;
    const client = this.requireOnline();
    const cookies = await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out getting a Steam web session')), 30_000);
      client.once('webSession', (_sid: string, c: string[]) => {
        clearTimeout(timer);
        resolve(c);
      });
      client.webLogOn();
    });
    return cookies;
  }

  private async farmTick(): Promise<void> {
    this.farmTimer = null;
    if (!this.account.farming || this.status !== 'online') return;
    try {
      let badges: DropInfo[];
      try {
        badges = await fetchBadgeGames(this.account.steamId!, await this.ensureWebSession());
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('session expired')) throw err;
        this.webSessionAt = 0;
        badges = await fetchBadgeGames(this.account.steamId!, await this.ensureWebSession());
      }
      const drops = badges.filter((b) => b.dropsRemaining > 0);
      if (!this.account.farming) return;
      const blacklist = new Set(this.account.farm.blacklist);
      // Farm the games closest to finishing first so badges complete sooner.
      this.farmGames = drops.filter((d) => !blacklist.has(d.appid)).sort((a, b) => a.dropsRemaining - b.dropsRemaining);
      this.farmLastCheck = Date.now();
      const total = this.farmGames.reduce((n, g) => n + g.dropsRemaining, 0);
      if (this.farmGames.length === 0) {
        this.farmMessage = `No card drops remaining (checked ${badges.length} game badge(s))`;
        this.log.info(`Card farming finished: ${this.farmMessage}`);
        this.stopFarming();
        return;
      }
      this.farmMessage = `${total} drop(s) left across ${this.farmGames.length} game(s) (checked ${badges.length} game badge(s))`;
      this.log.info(`Card farming: ${this.farmMessage}`);
      this.applyGames();
    } catch (err) {
      this.farmMessage = `Check failed: ${(err as Error).message}`;
      this.log.warn(this.farmMessage);
    }
    if (this.account.farming) {
      this.farmTimer = setTimeout(() => void this.farmTick(), this.account.farm.checkIntervalMin * 60_000);
    }
  }

  // -------------------------------------------------------------- free games

  /** Claim one free promotion. Returns false when the account already owns it. */
  async claimFree(promo: FreePromo): Promise<boolean> {
    const client = this.requireOnline();
    let packageid = promo.packageid;
    if (promo.appid) {
      const owned = await this.getOwnedGames();
      if (owned.some((g) => g.appid === promo.appid)) {
        this.markClaimed(promo.key);
        return false;
      }
      const details = await fetchAppDetails(promo.appid);
      // DLC can only be added to an account that owns the game it belongs to.
      const baseAppid = Number(details?.fullgame?.appid);
      if (details?.type === 'dlc' && baseAppid && !owned.some((g) => g.appid === baseAppid)) {
        const reason = `Needs ${details.fullgame?.name ?? `app ${baseAppid}`}`;
        this.account.skippedFree[promo.key] = reason;
        store.save();
        throw new Error(`${reason}, which this account doesn't own`);
      }
      // Search results often leave out the package (always for DLC); the store page knows it.
      packageid ??= pickFreePackage(details);
    }
    if (packageid) {
      await this.addFreeLicense(packageid);
    } else {
      const res = await client.requestFreeLicense([promo.appid]);
      if (!res.grantedAppIds?.length && !res.grantedPackageIds?.length) throw new Error('Steam did not grant a license');
    }
    delete this.account.skippedFree[promo.key];
    this.markClaimed(promo.key);
    this.ownedGamesAt = 0;
    this.libraryVersion++;
    this.log.info(`Claimed free game: ${promo.name}`);
    return true;
  }

  /** Called by the free game watcher with everything currently free. */
  async autoClaimFree(promos: FreePromo[]): Promise<void> {
    if (!this.account.autoClaimFree || this.status !== 'online') return;
    for (const promo of promos) {
      if (this.account.claimedFree.includes(promo.key) || this.account.skippedFree[promo.key]) continue;
      try {
        await this.claimFree(promo);
      } catch (err) {
        this.log.warn(`Could not claim ${promo.name}: ${(err as Error).message}`);
      }
    }
  }

  private markClaimed(key: string): void {
    if (!this.account.claimedFree.includes(key)) {
      this.account.claimedFree.push(key);
      // Promotions don't come back with the same package often; keep the list bounded.
      if (this.account.claimedFree.length > 2000) this.account.claimedFree.splice(0, this.account.claimedFree.length - 2000);
      store.save();
    }
  }

  /** The store's "Add to Account" for free packages. */
  async addFreeLicense(packageid: number): Promise<void> {
    const cookies = await this.ensureWebSession();
    const sessionid = cookies.find((c) => c.startsWith('sessionid='))?.slice('sessionid='.length);
    if (!sessionid) throw new Error('Steam web session has no sessionid');
    const res = await fetch(`https://store.steampowered.com/freelicense/addfreelicense/${packageid}`, {
      method: 'POST',
      headers: {
        Cookie: cookies.join('; '),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 steamfarm',
        Origin: 'https://store.steampowered.com',
        Referer: 'https://store.steampowered.com/',
      },
      body: new URLSearchParams({ ajax: 'true', sessionid }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400) throw new Error('Steam store session expired');
    if (res.status === 401 || res.status === 403) throw new Error(`Store refused the license (HTTP ${res.status})`);
    if (!res.ok && res.status !== 500) throw new Error(`Store returned HTTP ${res.status}`);
    // The body is inconsistent (array, object or null); only an object can carry an error.
    let body: unknown = null;
    try {
      body = JSON.parse(await res.text());
    } catch {
      // Not JSON: nothing more to learn from it.
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const { purchaseresultdetail, error } = body as { purchaseresultdetail?: number; error?: string };
      if (purchaseresultdetail) {
        throw Object.assign(new Error(`Store refused the license (purchase result ${purchaseresultdetail})`), { purchaseResult: purchaseresultdetail });
      }
      if (error) throw new Error(`Store refused the license: ${error}`);
    }
    if (res.status === 500) throw new Error('Store returned HTTP 500');
  }

  // ----------------------------------------------------------- free licenses

  /** The logged-in Steam client, for the PICS watcher. */
  get steamClient(): any {
    return this.status === 'online' ? this.client : null;
  }

  /** Packages and apps this account owns, from its license list. */
  private async ownership(): Promise<{ apps: Set<number>; packages: Set<number> }> {
    const client = this.requireOnline();
    const packages = new Set<number>((client.licenses ?? []).map((l: any) => Number(l.package_id)));
    const unknown = [...packages].filter((id) => !this.licenseApps.has(id));
    if (unknown.length) {
      const info = await productInfo(client, [], unknown);
      for (const id of unknown) {
        const appids = info.packages[id]?.appids;
        this.licenseApps.set(id, appids && typeof appids === 'object' ? Object.values(appids).map(Number) : []);
      }
    }
    const apps = new Set<number>();
    for (const id of packages) for (const appid of this.licenseApps.get(id) ?? []) apps.add(appid);
    return { apps, packages };
  }

  /** Called by the watcher with free apps and packages that just changed on Steam. */
  async queueFreeLicenses(found: FreeLicenseCandidate[]): Promise<void> {
    const l = this.account.freeLicenses;
    if (!l.enabled || this.status !== 'online' || !found.length) return;
    const { apps, packages } = await this.ownership();
    const country: string | null = this.client?.accountInfo?.country?.toUpperCase() || null;
    const queued = new Set(l.queue.map((q) => `${q.kind}/${q.id}`));
    let added = 0;
    for (const c of found) {
      if (queued.has(`${c.kind}/${c.id}`) || !isWanted(c, l.types)) continue;
      const ok = c.kind === 'app'
        ? isRedeemableApp(c.app!, apps, country)
        : isRedeemablePackage(c.pkg!, c.contents ?? [], apps, packages, country);
      if (!ok) continue;
      if (c.kind === 'sub') {
        // A package explains failures better than its apps, so drop the apps it covers.
        const covered = new Set(c.pkg!.appids);
        l.queue = l.queue.filter((q) => q.kind !== 'app' || !covered.has(q.id));
      }
      l.queue.push({ kind: c.kind, id: c.id, name: c.name });
      queued.add(`${c.kind}/${c.id}`);
      added++;
    }
    if (!added) return;
    store.save();
    this.log.info(`Queued ${added} free license(s) to claim`);
    if (!this.licenseTimer) this.scheduleLicense(1000);
  }

  private stopLicenseTimer(): void {
    if (this.licenseTimer) clearTimeout(this.licenseTimer);
    this.licenseTimer = null;
  }

  private scheduleLicense(ms: number): void {
    this.stopLicenseTimer();
    const l = this.account.freeLicenses;
    if (!l.enabled || !l.queue.length) return;
    this.licenseTimer = setTimeout(() => void this.licenseTick(), Math.max(1000, ms));
  }

  private recordLicense(item: { kind: 'app' | 'sub'; id: number; name: string }, ok: boolean, result: string): void {
    const l = this.account.freeLicenses;
    l.history.unshift({ ...item, at: Date.now(), ok, result });
    l.history.length = Math.min(l.history.length, 100);
  }

  private async licenseTick(): Promise<void> {
    this.licenseTimer = null;
    const l = this.account.freeLicenses;
    if (this.status !== 'online' || !l.enabled || !l.queue.length) return;
    const now = Date.now();
    if (l.pausedUntil > now) return this.scheduleLicense(l.pausedUntil - now);
    l.activations = l.activations.filter((t) => now - t < ACTIVATION_PERIOD_MS);
    if (l.activations.length >= ACTIVATION_LIMIT) {
      l.pausedUntil = Math.min(...l.activations) + ACTIVATION_PERIOD_MS + 60_000;
      store.save();
      this.log.info(`Pausing free license activations until ${new Date(l.pausedUntil).toLocaleTimeString()} (Steam allows about 30 per 90 minutes)`);
      return this.scheduleLicense(l.pausedUntil - now);
    }

    const item = l.queue[0];
    let next = 5000;
    l.activations.push(now);
    try {
      if (item.kind === 'app') {
        const res = await this.client.requestFreeLicense([item.id]);
        const granted = [...(res.grantedAppIds ?? []).map((id: number) => `app/${id}`), ...(res.grantedPackageIds ?? []).map((id: number) => `sub/${id}`)];
        this.recordLicense(item, granted.length > 0, granted.length ? `Granted ${granted.join(', ')}` : 'Nothing granted');
        if (granted.length) this.log.info(`Claimed free license app/${item.id} (${item.name}): ${granted.join(', ')}`);
      } else {
        await this.addFreeLicense(item.id);
        this.recordLicense(item, true, 'Granted');
        this.log.info(`Claimed free license sub/${item.id} (${item.name})`);
      }
      this.ownedGamesAt = 0;
      this.libraryVersion++;
      l.queue.shift();
    } catch (err) {
      const e = err as Error & { eresult?: number; purchaseResult?: number };
      // EResult 84 RateLimitExceeded; purchase result 53 "too many recent purchases".
      if (e.eresult === SteamUser.EResult.RateLimitExceeded || e.purchaseResult === 53) {
        l.pausedUntil = now + ACTIVATION_PERIOD_MS + 60_000;
        this.log.info(`Steam rate-limited free license activations; pausing until ${new Date(l.pausedUntil).toLocaleTimeString()}`);
        next = l.pausedUntil - now;
      } else if (e.eresult === SteamUser.EResult.Timeout || /timed? ?out|session expired/i.test(e.message)) {
        l.activations.pop();
        next = 5 * 60_000;
      } else {
        l.queue.shift();
        this.recordLicense(item, false, e.message);
        this.log.warn(`Could not claim ${item.kind}/${item.id} (${item.name}): ${e.message}`);
      }
    }
    store.save();
    this.scheduleLicense(next);
  }

  // ------------------------------------------------------------- inventory

  /** Steam currency code of the account's wallet (1 = USD when unknown). */
  get currencyCode(): number {
    return Number(this.client?.wallet?.currency) || 1;
  }

  async inventory(force = false): Promise<{ currency: string; items: InventoryItem[] }> {
    this.requireOnline();
    if (force || !this.inventoryCache || Date.now() - this.inventoryAt > 5 * 60_000) {
      this.inventoryCache = await this.withWebSession((cookies) => fetchInventory(this.account.steamId!, cookies));
      this.inventoryAt = Date.now();
    }
    return { currency: CURRENCIES[this.currencyCode] ?? 'USD', items: this.inventoryCache };
  }

  price(marketHashName: string): Promise<PriceInfo> {
    this.requireOnline();
    return priceOverview(marketHashName, this.currencyCode);
  }

  /**
   * List items on the Community Market, one at a time in the background.
   * Only asset IDs from this account's inventory are accepted.
   */
  startSelling(items: { assetid: string; price: number }[]): number {
    this.requireOnline();
    if (this.sellJob?.running) throw Object.assign(new Error('Already listing items; wait for it to finish'), { status: 409 });
    if (!this.inventoryCache) throw Object.assign(new Error('Load the inventory first'), { status: 400 });
    const owned = new Map<string, InventoryItem>();
    for (const item of this.inventoryCache) for (const id of item.assetids) owned.set(id, item);
    const queue: { assetid: string; price: number; name: string }[] = [];
    const seen = new Set<string>();
    for (const { assetid, price } of items) {
      const item = owned.get(String(assetid));
      if (!item || !item.marketable) throw Object.assign(new Error(`Item ${assetid} is not a marketable item in this inventory`), { status: 400 });
      if (!Number.isInteger(price) || price < MIN_BUYER_PRICE || price > MAX_BUYER_PRICE) {
        throw Object.assign(new Error(`Invalid price for ${item.name}`), { status: 400 });
      }
      if (seen.has(String(assetid))) continue;
      seen.add(String(assetid));
      queue.push({ assetid: String(assetid), price, name: item.name });
    }
    if (!queue.length) throw Object.assign(new Error('Nothing to list'), { status: 400 });
    const job = { running: true, total: queue.length, done: 0, listed: 0, failed: 0, needsConfirmation: 0, errors: [] as string[], finishedAt: 0 };
    this.sellJob = job;
    this.log.info(`Listing ${queue.length} item(s) on the Community Market`);
    void (async () => {
      for (const entry of queue) {
        if (this.status !== 'online') {
          job.errors.push('Account went offline; stopped');
          break;
        }
        let result: SellResult;
        try {
          result = await this.withWebSession((cookies) => sellItem(this.account.steamId!, cookies, entry.assetid, entry.price));
        } catch (err) {
          result = { assetid: entry.assetid, ok: false, error: (err as Error).message };
        }
        job.done++;
        if (result.ok) {
          job.listed++;
          if (result.needsConfirmation) job.needsConfirmation++;
        } else {
          job.failed++;
          if (job.errors.length < 20) job.errors.push(`${entry.name}: ${result.error}`);
        }
        // Steam throttles rapid listing; keep a steady pace.
        await new Promise((r) => setTimeout(r, 1_500));
      }
      job.running = false;
      job.finishedAt = Date.now();
      this.inventoryCache = null;
      const confirm = job.needsConfirmation ? `, ${job.needsConfirmation} waiting for confirmation in the Steam app` : '';
      this.log.info(`Market: listed ${job.listed} of ${job.total} item(s)${confirm}${job.failed ? `, ${job.failed} failed` : ''}`);
    })();
    return queue.length;
  }

  listings(): Promise<Listing[]> {
    this.requireOnline();
    return this.withWebSession((cookies) => fetchListings(cookies));
  }

  async removeListings(ids: string[]): Promise<{ removed: number; errors: string[] }> {
    this.requireOnline();
    let removed = 0;
    const errors: string[] = [];
    for (const id of ids.slice(0, 500)) {
      try {
        await this.withWebSession((cookies) => removeListing(this.account.steamId!, cookies, String(id)));
        removed++;
      } catch (err) {
        errors.push((err as Error).message);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (removed) this.log.info(`Market: removed ${removed} listing(s)`);
    return { removed, errors };
  }

  /** Run a web request with the session cookies, renewing the session once if it has expired. */
  private async withWebSession<T>(fn: (cookies: string[]) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.ensureWebSession());
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('session expired')) throw err;
      this.webSessionAt = 0;
      return fn(await this.ensureWebSession());
    }
  }

  // ------------------------------------------------------------- achievements

  async getAchievements(appid: number): Promise<UserStats> {
    const client = this.requireOnline();
    const [stats, percents] = await Promise.all([getUserStats(client, appid), getGlobalPercentages(appid)]);
    for (const a of stats.achievements) {
      const p = percents.get(a.name);
      if (p !== undefined) a.percent = p;
    }
    return stats;
  }

  async setAchievements(appid: number, changes: Record<string, boolean>): Promise<string[]> {
    const changed = await setAchievements(this.requireOnline(), appid, changes);
    if (changed.length) this.log.info(`App ${appid}: changed ${changed.length} achievement(s): ${changed.join(', ')}`);
    return changed;
  }

  /** Unlock the remaining achievements of a game one by one with random delays. */
  async startUnlocker(appid: number, minDelaySec: number, maxDelaySec: number, idle: boolean): Promise<number> {
    const stats = await this.getAchievements(appid);
    const queue = stats.achievements
      .filter((a) => !a.unlocked && !a.protected)
      // Most common achievements first, which is the order a real player tends to earn them.
      .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
      .map((a) => a.name);
    if (queue.length === 0) throw new Error('Nothing to unlock');
    const min = Math.max(1, Math.floor(minDelaySec));
    const max = Math.max(min, Math.floor(maxDelaySec));
    this.account.unlocker = {
      appid,
      queue,
      total: queue.length,
      minDelaySec: min,
      maxDelaySec: max,
      idle,
      nextAt: Date.now() + randomBetween(min, max) * 1000,
    };
    store.save();
    this.log.info(`Achievement unlocker: ${queue.length} achievement(s) queued for app ${appid}`);
    this.applyGames();
    this.scheduleUnlock();
    return queue.length;
  }

  stopUnlocker(): void {
    if (!this.account.unlocker) return;
    this.account.unlocker = undefined;
    store.save();
    this.stopUnlockTimer();
    this.log.info('Achievement unlocker stopped');
    this.applyGames();
  }

  private stopUnlockTimer(): void {
    if (this.unlockTimer) clearTimeout(this.unlockTimer);
    this.unlockTimer = null;
  }

  private scheduleUnlock(): void {
    this.stopUnlockTimer();
    const task = this.account.unlocker;
    if (!task) return;
    const wait = Math.max(0, task.nextAt - Date.now());
    this.unlockTimer = setTimeout(() => void this.unlockTick(), wait);
  }

  private async unlockTick(): Promise<void> {
    this.unlockTimer = null;
    const task = this.account.unlocker;
    if (!task || this.status !== 'online') return;
    const name = task.queue[0];
    try {
      await this.setAchievements(task.appid, { [name]: true });
      task.queue.shift();
    } catch (err) {
      this.log.warn(`Unlock of ${name} failed: ${(err as Error).message}; will retry`);
    }
    if (task.queue.length === 0) {
      this.log.info(`Achievement unlocker finished for app ${task.appid}`);
      this.stopUnlocker();
      return;
    }
    task.nextAt = Date.now() + randomBetween(task.minDelaySec, task.maxDelaySec) * 1000;
    store.save();
    this.scheduleUnlock();
  }

  // ------------------------------------------------------------------- state

  snapshot() {
    const a = this.account;
    return {
      username: a.username,
      steamId: a.steamId ?? null,
      personaName: this.personaName,
      avatarUrl: this.avatarUrl,
      status: this.status,
      statusMessage: this.statusMessage,
      guard: this.guard,
      hasLogin: Boolean(a.refreshToken),
      hasSharedSecret: Boolean(a.sharedSecret),
      playingBlocked: this.playingBlocked,
      playing: this.status === 'online' ? this.playing : [],
      idling: this.idlingDetails(),
      favorites: a.favorites,
      libraryVersion: this.libraryVersion,
      settings: {
        autoStart: a.autoStart,
        personaState: a.personaState,
        customStatus: a.customStatus,
        idleGames: a.idleGames,
        farm: a.farm,
      },
      farming: {
        active: a.farming,
        games: this.farmGames,
        lastCheck: this.farmLastCheck,
        message: this.farmMessage,
      },
      freeGames: { autoClaim: a.autoClaimFree, claimed: a.claimedFree, skipped: a.skippedFree },
      freeLicenses: {
        enabled: a.freeLicenses.enabled,
        types: a.freeLicenses.types,
        queued: a.freeLicenses.queue.length,
        upNext: a.freeLicenses.queue.slice(0, 10),
        recent: a.freeLicenses.activations.filter((t) => Date.now() - t < ACTIVATION_PERIOD_MS).length,
        limit: ACTIVATION_LIMIT,
        pausedUntil: a.freeLicenses.pausedUntil > Date.now() ? a.freeLicenses.pausedUntil : 0,
        history: a.freeLicenses.history.slice(0, 30),
      },
      sellJob: this.sellJob,
      unlocker: a.unlocker
        ? {
            appid: a.unlocker.appid,
            remaining: a.unlocker.queue.length,
            total: a.unlocker.total ?? a.unlocker.queue.length,
            nextAt: a.unlocker.nextAt,
            idle: a.unlocker.idle,
          }
        : null,
    };
  }
}
