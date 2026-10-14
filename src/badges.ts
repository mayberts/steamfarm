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

/** Parse one page of steamcommunity.com/profiles/<id>/badges (English). Exported for tests. */
export function parseBadgePage(html: string): BadgePage {
  // A logged-in badge page always has the user's own "badges" tab and the
  // owner-only drop counters; the anonymous view has neither.
  const loggedIn = !/g_steamID\s*=\s*false/.test(html);
  const games: DropInfo[] = [];

  for (const row of html.split(/<div class="badge_row[ "]/).slice(1)) {
    const appMatch = row.match(/\/gamecards\/(\d+)\//);
    if (!appMatch) continue;
    const dropsMatch = row.match(/(\d+) card drops? remaining/i);
    const dropsRemaining = dropsMatch ? Number(dropsMatch[1]) : 0;
    const titleMatch = row.match(/<div class="badge_title">\s*([\s\S]*?)(?:<span|<\/div>)/);
    const hoursMatch = row.match(/([\d,.]+) hrs on record/);
    games.push({
      appid: Number(appMatch[1]),
      name: titleMatch ? decodeEntities(titleMatch[1]).trim() : `App ${appMatch[1]}`,
      dropsRemaining,
      hoursPlayed: hoursMatch ? Number(hoursMatch[1].replace(/,/g, '')) : 0,
    });
  }

  let totalPages = 1;
  for (const m of html.matchAll(/class="pagelink"[^>]*>(\d+)</g)) totalPages = Math.max(totalPages, Number(m[1]));

  return { games, totalPages, loggedIn };
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
    totalPages = parsed.totalPages;
    for (const g of parsed.games) all.set(g.appid, g);
  }
  return [...all.values()];
}
