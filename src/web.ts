import crypto from 'node:crypto';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { appLog } from './log';
import { manager } from './manager';
import { store } from './store';

const COOKIE = 'steamfarm_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

function getWebPassword(): string {
  if (config.webPassword) return config.webPassword;
  if (!store.raw.webPassword) {
    store.raw.webPassword = crypto.randomBytes(12).toString('base64url');
    store.flush();
  }
  return store.raw.webPassword;
}

function sessionSecret(): string {
  if (!store.raw.sessionSecret) {
    store.raw.sessionSecret = crypto.randomBytes(32).toString('hex');
    store.flush();
  }
  return store.raw.sessionSecret;
}

function sign(expires: number): string {
  const mac = crypto.createHmac('sha256', sessionSecret()).update(String(expires)).digest('base64url');
  return `${expires}.${mac}`;
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function validSession(token: string | undefined): boolean {
  if (!token) return false;
  const [exp] = token.split('.');
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  return safeEqual(token, sign(expires));
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// Simple in-memory login throttle per IP.
const attempts = new Map<string, { count: number; until: number }>();
function throttled(ip: string): boolean {
  const a = attempts.get(ip);
  return Boolean(a && a.count >= 5 && a.until > Date.now());
}
function recordFailure(ip: string): void {
  const a = attempts.get(ip);
  if (!a || a.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + 15 * 60_000 });
  else a.count++;
}

type Handler = (req: Request, res: Response) => unknown;
/** Wrap a handler so thrown errors (sync or async) become JSON error responses. */
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    next(err);
  }
};

function appidParam(req: Request): number {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) throw Object.assign(new Error('Invalid app ID'), { status: 400 });
  return appid;
}

const param = (req: Request, name: string): string => String(req.params[name]);

export function createServer() {
  const password = getWebPassword();
  if (!config.webPassword) {
    appLog.warn(`WEB_PASSWORD is not set. Generated web UI password: ${password}`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (throttled(ip)) {
      res.status(429).json({ error: 'Too many attempts; try again later' });
      return;
    }
    if (typeof req.body?.password !== 'string' || !safeEqual(req.body.password, password)) {
      recordFailure(ip);
      res.status(401).json({ error: 'Wrong password' });
      return;
    }
    attempts.delete(ip);
    const expires = Date.now() + SESSION_TTL_MS;
    res.cookie(COOKIE, sign(expires), {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      expires: new Date(expires),
      path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ authenticated: validSession(readCookie(req, COOKIE)) });
  });

  // Everything below requires a session.
  const api = express.Router();
  api.use((req, res, next) => {
    if (!validSession(readCookie(req, COOKIE))) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    next();
  });

  api.get('/state', h(() => ({ accounts: manager.list().map((b) => b.snapshot()), log: appLog.recent(50) })));

  api.post('/accounts', h((req) => {
    const { username, password, sharedSecret } = req.body ?? {};
    const bot = manager.addWithPassword(String(username ?? ''), String(password ?? ''), sharedSecret ? String(sharedSecret) : undefined);
    return bot.snapshot();
  }));

  api.post('/accounts/qr', h(() => manager.startQrLogin()));
  api.get('/accounts/qr/:id', h((req) => manager.qrStatus(param(req, 'id'))));

  api.delete('/accounts/:name', h((req) => manager.remove(param(req, 'name'))));
  api.get('/accounts/:name/log', h((req) => manager.get(param(req, 'name')).log.recent(200)));

  api.post('/accounts/:name/start', h((req) => manager.get(param(req, 'name')).start()));
  api.post('/accounts/:name/stop', h((req) => manager.get(param(req, 'name')).stop()));
  api.post('/accounts/:name/guard', h((req) => manager.get(param(req, 'name')).submitGuardCode(String(req.body?.code ?? ''))));
  api.put('/accounts/:name/settings', h((req) => {
    const bot = manager.get(param(req, 'name'));
    bot.updateSettings(req.body ?? {});
    return bot.snapshot();
  }));

  api.get('/accounts/:name/games', h((req) => manager.get(param(req, 'name')).getOwnedGames(req.query.refresh === '1')));
  api.put('/accounts/:name/idle', h((req) => {
    const appids = Array.isArray(req.body?.appids) ? req.body.appids.map(Number) : [];
    manager.get(param(req, 'name')).setIdleGames(appids);
  }));

  api.post('/accounts/:name/farm/start', h((req) => manager.get(param(req, 'name')).startFarming()));
  api.post('/accounts/:name/farm/stop', h((req) => manager.get(param(req, 'name')).stopFarming()));

  api.get('/accounts/:name/achievements/:appid', h(async (req) => {
    const stats = await manager.get(param(req, 'name')).getAchievements(appidParam(req));
    return { appid: stats.appid, achievements: stats.achievements };
  }));
  api.post('/accounts/:name/achievements/:appid', h(async (req) => {
    const changes: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(req.body?.changes ?? {})) changes[k] = Boolean(v);
    return { changed: await manager.get(param(req, 'name')).setAchievements(appidParam(req), changes) };
  }));

  api.post('/accounts/:name/unlocker', h(async (req) => {
    const { appid, minDelaySec, maxDelaySec, idle } = req.body ?? {};
    const queued = await manager
      .get(param(req, 'name'))
      .startUnlocker(Number(appid), Number(minDelaySec ?? 60), Number(maxDelaySec ?? 300), Boolean(idle));
    return { queued };
  }));
  api.delete('/accounts/:name/unlocker', h((req) => manager.get(param(req, 'name')).stopUnlocker()));

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '5m' }));

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) appLog.error(err.stack ?? err.message);
    res.status(status).json({ error: err.message });
  });

  return app;
}
