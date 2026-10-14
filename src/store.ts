import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { appLog } from './log';

export type PersonaStateName = 'online' | 'away' | 'invisible' | 'offline';

export interface FarmSettings {
  /** Number of games with card drops to idle simultaneously (1-32). */
  maxConcurrent: number;
  /** Minutes between badge page re-checks. */
  checkIntervalMin: number;
  /** App IDs that are never farmed. */
  blacklist: number[];
  /** Start farming automatically when the account logs in. */
  autoStart: boolean;
}

export interface UnlockerTask {
  appid: number;
  /** Achievement API names still to unlock, in order. */
  queue: string[];
  minDelaySec: number;
  maxDelaySec: number;
  /** Also "play" the game while unlocking, so unlocks happen during a session. */
  idle: boolean;
  /** When the next unlock is due (epoch ms). */
  nextAt: number;
}

export interface AccountRecord {
  /** Steam login name, lower-cased; used as the account key. */
  username: string;
  refreshToken?: string;
  /** Optional mobile authenticator shared secret for automatic Steam Guard codes. */
  sharedSecret?: string;
  steamId?: string;
  /** Start this account automatically when the container starts. */
  autoStart: boolean;
  personaState: PersonaStateName;
  /** Shown to friends as "In non-Steam game: <text>". Takes one of the 32 game slots. */
  customStatus: string;
  /** App IDs idled by the playtime booster. */
  idleGames: number[];
  farm: FarmSettings;
  farming: boolean;
  unlocker?: UnlockerTask;
  /** Claim free-to-keep promotions automatically. */
  autoClaimFree: boolean;
  /** Keys of free promotions already claimed (or found already owned) by this account. */
  claimedFree: string[];
}

export interface FreePromo {
  /** "sub/<id>" for a package, "app/<id>" for an app without a package. */
  key: string;
  appid?: number;
  packageid?: number;
  name: string;
  url: string;
}

export interface FreeGamesSettings {
  enabled: boolean;
  intervalMin: number;
  /** Discord webhook or any URL that accepts a POSTed text message (e.g. ntfy). */
  webhookUrl: string;
  /** Promotions already announced, so each is alerted once. */
  seen: Record<string, FreePromo & { firstSeen: number }>;
}

interface StoreFile {
  version: 1;
  webPassword?: string;
  sessionSecret?: string;
  freeGames?: FreeGamesSettings;
  accounts: Record<string, AccountRecord>;
}

export function defaultAccount(username: string): AccountRecord {
  return {
    username: username.toLowerCase(),
    autoStart: true,
    personaState: 'online',
    customStatus: '',
    idleGames: [],
    farm: { maxConcurrent: 32, checkIntervalMin: 15, blacklist: [], autoStart: false },
    farming: false,
    autoClaimFree: false,
    claimedFree: [],
  };
}

/** Tiny JSON-file store. Writes are atomic (write temp file, then rename). */
class Store {
  private readonly file = path.join(config.dataDir, 'steamfarm.json');
  private data: StoreFile = { version: 1, accounts: {} };
  private saveTimer: NodeJS.Timeout | null = null;

  load(): void {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    try {
      fs.accessSync(config.dataDir, fs.constants.W_OK);
    } catch {
      const uid = process.getuid?.() ?? '?';
      const gid = process.getgid?.() ?? '?';
      throw new Error(
        `${config.dataDir} is not writable by uid ${uid} gid ${gid}. ` +
          'Set PUID/PGID to the owner of the data folder (Unraid: PUID=99, PGID=100) or fix its permissions.',
      );
    }
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoreFile;
      // Fill in fields added in newer versions.
      for (const [key, acc] of Object.entries(this.data.accounts)) {
        const base = defaultAccount(acc.username ?? key);
        this.data.accounts[key] = { ...base, ...acc, farm: { ...base.farm, ...acc.farm } };
      }
    }
  }

  get raw(): StoreFile {
    return this.data;
  }

  freeGames(): FreeGamesSettings {
    this.data.freeGames = { enabled: true, intervalMin: 60, webhookUrl: '', seen: {}, ...this.data.freeGames };
    return this.data.freeGames;
  }

  accounts(): AccountRecord[] {
    return Object.values(this.data.accounts);
  }

  account(username: string): AccountRecord | undefined {
    return this.data.accounts[username.toLowerCase()];
  }

  upsertAccount(acc: AccountRecord): void {
    this.data.accounts[acc.username] = acc;
    this.save();
  }

  deleteAccount(username: string): void {
    delete this.data.accounts[username.toLowerCase()];
    this.save();
  }

  /** Debounced save; call after mutating any record. */
  save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.flush();
      } catch (err) {
        appLog.error(`Could not save ${this.file}: ${(err as Error).message}`);
      }
    }, 250);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

export const store = new Store();
