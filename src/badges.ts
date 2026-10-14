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

/** Fetch every badge page and return the games that still have card drops. */
export async function fetchCardDrops(steamId: string, cookies: string[]): Promise<DropInfo[]> {
  const headers = { Cookie: cookies.join('; '), 'User-Agent': 'Mozilla/5.0 steamfarm' };
  const all = new Map<number, DropInfo>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= 100; page++) {
    const url = `https://steamcommunity.com/profiles/${steamId}/badges/?l=english&p=${page}`;
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (res.status >= 300 && res.status < 400) throw new Error('Steam web session expired');
    if (!res.ok) throw new Error(`Badge page returned HTTP ${res.status}`);
    const parsed = parseBadgePage(await res.text());
    if (!parsed.loggedIn) throw new Error('Steam web session expired');
    totalPages = parsed.totalPages;
    for (const g of parsed.games) all.set(g.appid, g);
  }
  return [...all.values()].filter((g) => g.dropsRemaining > 0);
}
