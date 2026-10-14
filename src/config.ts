import path from 'node:path';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: intEnv('PORT', 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  // If unset, a random password is generated on first start, saved to the
  // data directory and printed to the log.
  webPassword: process.env.WEB_PASSWORD ?? '',
  // Set to "true" when the UI is served over HTTPS (e.g. behind a reverse proxy).
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Steam allows at most 32 games to be "played" at once per account.
  maxGames: 32,
};
