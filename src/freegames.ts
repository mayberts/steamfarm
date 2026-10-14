import { appLog } from './log';
import { FreePromo, store } from './store';

const SEARCH_URL =
  'https://store.steampowered.com/search/results/?maxprice=free&specials=1&infinite=1&count=100&start=0&cc=us&l=english';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/**
 * Pull the 100%-off promotions out of Steam store search results HTML
 * (the `results_html` of a `maxprice=free&specials=1` search). Exported for tests.
 */
export function parseFreeSearch(html: string): FreePromo[] {
  const promos = new Map<string, FreePromo>();
  for (const row of html.split(/<a\b(?=[^>]*\bsearch_result_row\b)/).slice(1)) {
    const tag = row.slice(0, row.indexOf('>'));
    // Bundles can't be claimed as a free license.
    if (/data-ds-bundleid=/.test(tag)) continue;
    // Only rows actually discounted to free; "free" search also returns free-to-play games on other specials.
    const discount = row.match(/data-discount="(\d+)"/)?.[1] ?? row.match(/discount_pct">\s*-(\d+)%/)?.[1];
    if (discount !== '100') continue;

    const appid = Number(tag.match(/data-ds-appid="(\d+)/)?.[1]) || undefined;
    // A row can list several packages; the first is the one the store page sells.
    const packageid = Number(tag.match(/data-ds-packageid="(\d+)/)?.[1]) || undefined;
    if (!appid && !packageid) continue;
    const name = decodeEntities(row.match(/<span class="title">([^<]*)<\/span>/)?.[1] ?? '').trim();
    const href = tag.match(/href="([^"]+)"/)?.[1] ?? '';
    const key = packageid ? `sub/${packageid}` : `app/${appid}`;
    promos.set(key, {
      key,
      appid,
      packageid,
      name: name || (appid ? `App ${appid}` : `Package ${packageid}`),
      url: href.split('?')[0] || (appid ? `https://store.steampowered.com/app/${appid}/` : 'https://store.steampowered.com/'),
    });
  }
  return [...promos.values()];
}

export async function fetchFreePromos(): Promise<FreePromo[]> {
  const res = await fetch(SEARCH_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 steamfarm', Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Store search returned HTTP ${res.status}`);
  const json = (await res.json()) as { success?: number; results_html?: string };
  if (json.success !== 1 || typeof json.results_html !== 'string') throw new Error('Store search returned an unexpected response');
  return parseFreeSearch(json.results_html);
}

async function sendWebhook(url: string, promos: FreePromo[]): Promise<void> {
  const lines = promos.map((p) => `${p.name}: ${p.url}`);
  const text = `Free to keep on Steam:\n${lines.join('\n')}`;
  const discord = /discord(app)?\.com\/api\/webhooks\//.test(url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': discord ? 'application/json' : 'text/plain; charset=utf-8', Title: 'Free Steam games' },
    body: discord ? JSON.stringify({ content: text.slice(0, 1900) }) : text,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`webhook returned HTTP ${res.status}`);
}

export interface ClaimTarget {
  username: string;
  /** Claims anything currently free that this account wants and doesn't have. */
  autoClaimFree(promos: FreePromo[]): Promise<void>;
}

/** Polls the Steam store for free-to-keep promotions, alerts on new ones and triggers auto-claim. */
export class FreeGameWatcher {
  promos: FreePromo[] = [];
  lastCheck = 0;
  message = '';
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly targets: () => ClaimTarget[]) {}

  start(): void {
    this.schedule(15_000);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), delayMs);
  }

  /** Re-arm the timer after settings change. */
  reschedule(): void {
    const settings = store.freeGames();
    if (!settings.enabled) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.message = 'Checking is turned off';
      return;
    }
    const due = this.lastCheck + settings.intervalMin * 60_000 - Date.now();
    this.schedule(Math.max(5_000, due));
  }

  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const settings = store.freeGames();
    try {
      if (!settings.enabled) {
        this.message = 'Checking is turned off';
        return;
      }
      this.promos = await fetchFreePromos();
      this.lastCheck = Date.now();
      this.message = this.promos.length ? `${this.promos.length} free game(s) right now` : 'No free-to-keep games right now';

      const fresh = this.promos.filter((p) => !settings.seen[p.key]);
      for (const p of fresh) settings.seen[p.key] = { ...p, firstSeen: Date.now() };
      store.save();
      if (fresh.length) {
        appLog.info(`New free game(s): ${fresh.map((p) => p.name).join(', ')}`);
        if (settings.webhookUrl) {
          await sendWebhook(settings.webhookUrl, fresh).catch((err) => appLog.warn(`Free game alert failed: ${err.message}`));
        }
      }
      for (const target of this.targets()) {
        await target.autoClaimFree(this.promos).catch((err) => appLog.warn(`[${target.username}] auto-claim failed: ${err.message}`));
      }
    } catch (err) {
      // fetch() hides the network cause (DNS, TLS, refused) in `cause`.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const reason = `${(err as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ''}`;
      this.message = `Check failed: ${reason}`;
      appLog.warn(`Free game check failed: ${reason}`);
    } finally {
      this.running = false;
      if (store.freeGames().enabled) this.schedule(store.freeGames().intervalMin * 60_000);
    }
  }

  /** Send a test message to the configured webhook. */
  async testWebhook(): Promise<void> {
    const url = store.freeGames().webhookUrl;
    if (!url) throw Object.assign(new Error('No webhook URL is set'), { status: 400 });
    await sendWebhook(url, [{ key: 'test', name: 'Steamfarm test alert', url: 'https://store.steampowered.com/' }]);
  }
}
