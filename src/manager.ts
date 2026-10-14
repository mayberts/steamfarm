import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import { Bot } from './bot';
import { FreeGameWatcher } from './freegames';
import { appLog } from './log';
import { defaultAccount, store } from './store';

interface QrLogin {
  id: string;
  session: LoginSession;
  status: 'waiting' | 'done' | 'failed';
  qrDataUrl: string;
  username?: string;
  error?: string;
  createdAt: number;
}

class BotManager {
  private bots = new Map<string, Bot>();
  readonly freeGames = new FreeGameWatcher(() => this.list());
  private qrLogins = new Map<string, QrLogin>();

  init(): void {
    for (const acc of store.accounts()) {
      const bot = new Bot(acc);
      this.bots.set(acc.username, bot);
      if (acc.autoStart && acc.refreshToken) bot.start();
    }
    appLog.info(`Loaded ${this.bots.size} account(s)`);
    this.freeGames.start();
  }

  list(): Bot[] {
    return [...this.bots.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  get(username: string): Bot {
    const bot = this.bots.get(username.toLowerCase());
    if (!bot) throw Object.assign(new Error('Unknown account'), { status: 404 });
    return bot;
  }

  /** Add (or re-authenticate) an account using its password. */
  addWithPassword(username: string, password: string, sharedSecret?: string): Bot {
    const key = username.trim().toLowerCase();
    if (!key || !password) throw Object.assign(new Error('Username and password are required'), { status: 400 });
    const bot = this.ensureBot(key);
    bot.stop('Re-authenticating');
    delete bot.account.refreshToken;
    if (sharedSecret?.trim()) bot.account.sharedSecret = sharedSecret.trim();
    store.save();
    bot.start(password);
    return bot;
  }

  private ensureBot(key: string): Bot {
    let bot = this.bots.get(key);
    if (!bot) {
      const acc = store.account(key) ?? defaultAccount(key);
      store.upsertAccount(acc);
      bot = new Bot(acc);
      this.bots.set(key, bot);
    }
    return bot;
  }

  remove(username: string): void {
    const bot = this.get(username);
    bot.stop('Removed');
    this.bots.delete(bot.username);
    store.deleteAccount(bot.username);
    appLog.info(`Removed account ${bot.username}`);
  }

  /** Start a QR-code login; scan it with the Steam mobile app. */
  async startQrLogin(): Promise<{ id: string; qrDataUrl: string }> {
    this.pruneQr();
    const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
    const start = await session.startWithQR();
    const id = crypto.randomUUID();
    const entry: QrLogin = {
      id,
      session,
      status: 'waiting',
      qrDataUrl: await QRCode.toDataURL(start.qrChallengeUrl!, { margin: 1, width: 280 }),
      createdAt: Date.now(),
    };
    this.qrLogins.set(id, entry);

    session.on('remoteInteraction', () => appLog.info('QR code scanned; waiting for approval in the Steam app'));
    session.on('authenticated', () => {
      const key = session.accountName.toLowerCase();
      const bot = this.ensureBot(key);
      bot.stop('Re-authenticating');
      bot.account.refreshToken = session.refreshToken;
      store.save();
      entry.status = 'done';
      entry.username = key;
      appLog.info(`QR login succeeded for ${key}`);
      bot.start();
    });
    session.on('timeout', () => {
      entry.status = 'failed';
      entry.error = 'QR code expired';
    });
    session.on('error', (err: Error) => {
      entry.status = 'failed';
      entry.error = err.message;
    });
    return { id, qrDataUrl: entry.qrDataUrl };
  }

  qrStatus(id: string) {
    const entry = this.qrLogins.get(id);
    if (!entry) throw Object.assign(new Error('Unknown QR login'), { status: 404 });
    return { status: entry.status, username: entry.username, error: entry.error };
  }

  private pruneQr(): void {
    for (const [id, entry] of this.qrLogins) {
      if (Date.now() - entry.createdAt > 10 * 60_000) {
        entry.session.cancelLoginAttempt();
        this.qrLogins.delete(id);
      }
    }
  }

  shutdown(): void {
    for (const bot of this.bots.values()) {
      if (bot.status !== 'stopped') bot.stop('Shutting down');
    }
  }
}

export const manager = new BotManager();
