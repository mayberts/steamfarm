export interface DropInfo {
  appid: number;
  name: string;
  dropsRemaining: number;
  hoursPlayed: number;
}

export interface BadgePage {
  games: DropInfo[];
  totalPages: number;
  loggedIn: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

// Opening tag of a badge row: the outer `badge_row` or the `badge_row_inner` that holds the stats.
const ROW_START = /<div\b[^>]*\bclass="(?:[^"]*\s)?badge_row(?:_inner)?(?:\s[^"]*)?"[^>]*>/;

function textOf(html: string, className: string): string | undefined {
  const m = html.match(new RegExp(`class="${className}"[^>]*>([\\s\\S]*?)<`));
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : undefined;
}

/** Parse one page of steamcommunity.com/profiles/<id>/badges (English). Exported for tests. */
export function parseBadgePage(html: string): BadgePage {
  // The anonymous view sets g_steamID to false.
  const loggedIn = !/g_steamID\s*=\s*false/.test(html);
  const byApp = new Map<number, DropInfo>();

  for (const row of html.split(ROW_START).slice(1)) {
    // Only rows with stats are game badges; the outer row may just hold the overlay link.
    if (!/badge_title_stats|progress_info_bold/.test(row)) continue;
    const appMatch = row.match(/card_drop_info_gamebadge_(\d+)_/) ?? row.match(/\/gamecards\/(\d+)/);
    if (!appMatch) continue;
    const appid = Number(appMatch[1]);

    const progress = textOf(row, 'progress_info_bold') ?? '';
    const drops = /card drop/i.test(progress) ? Number(progress.match(/\d+/)?.[0] ?? 0) : 0;
    const hours = (textOf(row, 'badge_title_stats_playtime') ?? '').match(/[\d,]+(?:\.\d+)?/);
    const title = textOf(row, 'badge_title');

    const prev = byApp.get(appid);
    byApp.set(appid, {
      appid,
      name: title || prev?.name || `App ${appid}`,
      dropsRemaining: Math.max(drops, prev?.dropsRemaining ?? 0),
      hoursPlayed: hours ? Number(hours[0].replace(/,/g, '')) : (prev?.hoursPlayed ?? 0),
    });
  }

  let totalPages = 1;
  for (const m of html.matchAll(/class="pagelink"[^>]*>(\d+)</g)) totalPages = Math.max(totalPages, Number(m[1]));

  return { games: [...byApp.values()], totalPages, loggedIn };
}

/**
 * A short, secret-free summary of a badge page for the log, used when no badges
 * could be read so the cause can be diagnosed without the page itself.
 */
export function describeBadgePage(html: string): string {
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? 'none';
  const steamId = /g_steamID\s*=\s*"\d+"/.test(html) ? 'set' : /g_steamID\s*=\s*false/.test(html) ? 'false' : 'missing';
  return [
    `title "${decodeEntities(title)}"`,
    `${html.length} bytes`,
    `g_steamID ${steamId}`,
    `badge_row ${count(/\bbadge_row\b/g)}`,
    `badge_row_inner ${count(/badge_row_inner/g)}`,
    `card_drop_info ${count(/card_drop_info_gamebadge_/g)}`,
    `gamecards links ${count(/\/gamecards\//g)}`,
    `progress_info_bold ${count(/progress_info_bold/g)}`,
  ].join(', ');
}

const COMMUNITY_HOST = 'steamcommunity.com';
const MAX_REDIRECTS = 5;

/**
 * GET a Steam Community page, following redirects (a profile with a custom URL
 * redirects /profiles/<id>/... to /id/<name>/...). A redirect to the login page
 * means the web session is no longer valid.
 */
async function getCommunityPage(url: string, headers: Record<string, string>): Promise<{ url: string; html: string }> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Badge page returned HTTP ${res.status} without a redirect target`);
      const next = new URL(location, current);
      if (next.pathname.startsWith('/login')) throw new Error('Steam web session expired');
      // Never send the login cookies anywhere but Steam Community.
      if (next.hostname !== COMMUNITY_HOST) throw new Error(`Badge page redirected to an unexpected host (${next.hostname})`);
      current = next;
      continue;
    }
    if (!res.ok) throw new Error(`Badge page returned HTTP ${res.status}`);
    return { url: current.toString(), html: await res.text() };
  }
  throw new Error('Too many redirects loading the badge page');
}

/** Fetch every badge page and return every game badge found, with its remaining card drops. */
export async function fetchBadgeGames(steamId: string, cookies: string[]): Promise<DropInfo[]> {
  const headers = { Cookie: cookies.join('; '), 'User-Agent': 'Mozilla/5.0 steamfarm' };
  const all = new Map<number, DropInfo>();
  let profileBase = `https://${COMMUNITY_HOST}/profiles/${steamId}`;
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= 100; page++) {
    const pageUrl = (base: string) => `${base}/badges/?l=english&p=${page}`;
    let res = await getCommunityPage(pageUrl(profileBase), headers);
    // Remember where the profile actually lives so later pages skip the redirect.
    const moved = new URL(res.url).pathname.match(/^\/(?:id|profiles)\/[^/]+/);
    if (moved && `https://${COMMUNITY_HOST}${moved[0]}` !== profileBase) {
      profileBase = `https://${COMMUNITY_HOST}${moved[0]}`;
      // A redirect may drop the query string, which would give us the wrong page.
      if (new URL(res.url).searchParams.get('p') !== String(page)) res = await getCommunityPage(pageUrl(profileBase), headers);
    }
    const parsed = parseBadgePage(res.html);
    if (!parsed.loggedIn) throw new Error('Steam web session expired');
    if (page === 1 && parsed.games.length === 0) {
      throw new Error(`Could not read any game badges from your badge page (${describeBadgePage(res.html)})`);
    }
    totalPages = parsed.totalPages;
    for (const g of parsed.games) all.set(g.appid, g);
  }
  return [...all.values()];
}
