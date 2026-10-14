import path from 'node:path';
import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import { config } from './config';
import { Logger } from './log';
import { AccountRecord, FreePromo, PersonaStateName, store } from './store';
import { DropInfo, fetchBadgeGames } from './badges';
import { fetchAppDetails, pickFreePackage } from './freegames';
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
  private farmTimer: NodeJS.Timeout | null = null;
  private unlockTimer: NodeJS.Timeout | null = null;
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
    this.stopFarmTimer();
    this.stopUnlockTimer();
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
    this.client.gamesPlayed(this.currentGames());
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
    const res = await client.getUserOwnedApps(client.steamID, { includePlayedFreeGames: true, includeFreeSub: false });
    this.ownedGames = (res.apps ?? [])
      .map((a: any) => ({
        appid: a.appid,
        name: a.name ?? `App ${a.appid}`,
        playtimeMinutes: a.playtime_forever ?? 0,
        icon: a.img_icon_url ?? '',
      }))
      .sort((a: OwnedGame, b: OwnedGame) => a.name.localeCompare(b.name));
    this.ownedGamesAt = Date.now();
    return this.ownedGames!;
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
  private async addFreeLicense(packageid: number): Promise<void> {
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
      if (purchaseresultdetail) throw new Error(`Store refused the license (purchase result ${purchaseresultdetail})`);
      if (error) throw new Error(`Store refused the license: ${error}`);
    }
    if (res.status === 500) throw new Error('Store returned HTTP 500');
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
    this.account.unlocker = { appid, queue, minDelaySec: min, maxDelaySec: max, idle, nextAt: Date.now() + randomBetween(min, max) * 1000 };
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
      unlocker: a.unlocker
        ? { appid: a.unlocker.appid, remaining: a.unlocker.queue.length, nextAt: a.unlocker.nextAt, idle: a.unlocker.idle }
        : null,
    };
  }
}
