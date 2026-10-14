// Steam Community inventory (app 753, context 6: cards, backgrounds, emoticons,
// boosters, gems) and Community Market selling.

const COMMUNITY = 'https://steamcommunity.com';
const STEAM_APP = 753;
const COMMUNITY_CONTEXT = 6;
const UA = 'Mozilla/5.0 steamfarm';

/** Steam ECurrencyCode → ISO 4217, for formatting prices in the UI. */
export const CURRENCIES: Record<number, string> = {
  1: 'USD', 2: 'GBP', 3: 'EUR', 4: 'CHF', 5: 'RUB', 6: 'PLN', 7: 'BRL', 8: 'JPY', 9: 'NOK', 10: 'IDR',
  11: 'MYR', 12: 'PHP', 13: 'SGD', 14: 'THB', 15: 'VND', 16: 'KRW', 17: 'TRY', 18: 'UAH', 19: 'MXN',
  20: 'CAD', 21: 'AUD', 22: 'NZD', 23: 'CNY', 24: 'INR', 25: 'CLP', 26: 'PEN', 27: 'COP', 28: 'ZAR',
  29: 'HKD', 30: 'TWD', 31: 'SAR', 32: 'AED', 34: 'ARS', 35: 'ILS', 37: 'KZT', 38: 'KWD', 39: 'QAR',
  40: 'CRC', 41: 'UYU',
};

// ------------------------------------------------------------------- fees

const STEAM_FEE = 0.05;
const PUBLISHER_FEE = 0.1;

/** What the buyer pays when the seller is to receive `seller` (both in cents), as the market page computes it. */
export function buyerPays(seller: number): number {
  const steamFee = Math.floor(Math.max(seller * STEAM_FEE, 1));
  const publisherFee = Math.floor(Math.max(seller * PUBLISHER_FEE, 1));
  return seller + steamFee + publisherFee;
}

/** The most the seller can receive while the buyer pays at most `buyer` cents. 0 when below the market minimum. */
export function sellerReceives(buyer: number): number {
  let seller = Math.max(0, Math.floor(buyer / (1 + STEAM_FEE + PUBLISHER_FEE)) + 2);
  while (seller > 0 && buyerPays(seller) > buyer) seller--;
  return seller;
}

/** Parse a market price string such as "$1,234.56", "0,05€" or "£0.03" into cents. */
export function parsePrice(text: string | undefined): number | null {
  if (!text) return null;
  const s = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const m = s.match(/^(.*?)[.,](\d{2})$/);
  const whole = Number((m ? m[1] : s).replace(/[.,]/g, '') || '0');
  return whole * 100 + (m ? Number(m[2]) : 0);
}

// -------------------------------------------------------------- inventory

export interface InventoryItem {
  /** Asset IDs of every copy, so a stack can be sold one copy at a time. */
  assetids: string[];
  name: string;
  marketHashName: string;
  type: string;
  /** Broad category used for filtering. */
  kind: 'card' | 'foil' | 'background' | 'emoticon' | 'booster' | 'gems' | 'other';
  game: string;
  icon: string;
  marketable: boolean;
  tradable: boolean;
}

interface RawAsset {
  assetid: string;
  classid: string;
  instanceid: string;
  amount: string;
}

interface RawTag {
  category: string;
  internal_name: string;
  localized_tag_name?: string;
}

interface RawDescription {
  classid: string;
  instanceid: string;
  name: string;
  market_hash_name: string;
  type: string;
  icon_url: string;
  marketable: number;
  tradable: number;
  tags?: RawTag[];
}

function kindOf(tags: RawTag[]): InventoryItem['kind'] {
  const cls = tags.find((t) => t.category === 'item_class')?.internal_name ?? '';
  if (cls === 'item_class_2') return tags.some((t) => t.internal_name === 'cardborder_1') ? 'foil' : 'card';
  if (cls === 'item_class_3') return 'background';
  if (cls === 'item_class_4') return 'emoticon';
  if (cls === 'item_class_5') return 'booster';
  if (cls === 'item_class_7') return 'gems';
  return 'other';
}

/** Group raw inventory pages into one entry per distinct item, with every copy's asset ID. Exported for tests. */
export function groupInventory(assets: RawAsset[], descriptions: RawDescription[]): InventoryItem[] {
  const desc = new Map(descriptions.map((d) => [`${d.classid}_${d.instanceid}`, d]));
  const groups = new Map<string, InventoryItem>();
  for (const a of assets) {
    const d = desc.get(`${a.classid}_${a.instanceid}`);
    if (!d) continue;
    const key = `${d.market_hash_name}|${d.marketable}`;
    let item = groups.get(key);
    if (!item) {
      const tags = d.tags ?? [];
      item = {
        assetids: [],
        name: d.name,
        marketHashName: d.market_hash_name,
        type: d.type,
        kind: kindOf(tags),
        game: tags.find((t) => t.category === 'Game')?.localized_tag_name ?? '',
        icon: `https://community.cloudflare.steamstatic.com/economy/image/${d.icon_url}/128fx128f`,
        marketable: d.marketable === 1,
        tradable: d.tradable === 1,
      };
      groups.set(key, item);
    }
    // Gems come as one asset with an amount; everything else is one asset per copy.
    const copies = item.kind === 'gems' ? 1 : Math.max(1, Number(a.amount) || 1);
    for (let i = 0; i < copies; i++) item.assetids.push(a.assetid);
  }
  return [...groups.values()].sort((x, y) => x.game.localeCompare(y.game) || x.name.localeCompare(y.name));
}

function headers(cookies: string[], extra: Record<string, string> = {}): Record<string, string> {
  return { Cookie: cookies.join('; '), 'User-Agent': UA, ...extra };
}

export async function fetchInventory(steamId: string, cookies: string[]): Promise<InventoryItem[]> {
  const assets: RawAsset[] = [];
  const descriptions: RawDescription[] = [];
  let start = '';
  for (let page = 0; page < 50; page++) {
    const url = `${COMMUNITY}/inventory/${steamId}/${STEAM_APP}/${COMMUNITY_CONTEXT}?l=english&count=1000${start ? `&start_assetid=${start}` : ''}`;
    const res = await fetch(url, { headers: headers(cookies), redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (res.status === 403 || (res.status >= 300 && res.status < 400)) throw new Error('Steam web session expired');
    if (res.status === 429) throw new Error('Steam is rate limiting inventory requests; try again in a minute');
    if (!res.ok) throw new Error(`Inventory returned HTTP ${res.status}`);
    const json = (await res.json()) as { assets?: RawAsset[]; descriptions?: RawDescription[]; more_items?: number; last_assetid?: string };
    assets.push(...(json.assets ?? []));
    descriptions.push(...(json.descriptions ?? []));
    if (!json.more_items || !json.last_assetid) break;
    start = json.last_assetid;
  }
  return groupInventory(assets, descriptions);
}

// ----------------------------------------------------------------- prices

export interface PriceInfo {
  /** Lowest current listing price the buyer pays, in cents. */
  lowest: number | null;
  median: number | null;
  volume: number | null;
}

const priceCache = new Map<string, { at: number; info: PriceInfo }>();
const PRICE_TTL_MS = 30 * 60_000;
// priceoverview is rate limited (roughly 20 requests a minute); queue requests and space them out.
const PRICE_SPACING_MS = 3_000;
let priceQueue: Promise<unknown> = Promise.resolve();
let lastPriceAt = 0;

export function priceOverview(marketHashName: string, currency: number): Promise<PriceInfo> {
  const key = `${currency}|${marketHashName}`;
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return Promise.resolve(cached.info);
  const job = priceQueue.then(async () => {
    const again = priceCache.get(key);
    if (again && Date.now() - again.at < PRICE_TTL_MS) return again.info;
    const wait = lastPriceAt + PRICE_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastPriceAt = Date.now();
    const url = `${COMMUNITY}/market/priceoverview/?appid=${STEAM_APP}&currency=${currency}&market_hash_name=${encodeURIComponent(marketHashName)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) {
      // Back off for everyone queued behind us.
      lastPriceAt = Date.now() + 60_000;
      throw new Error('Steam is rate limiting price lookups; try again in a minute');
    }
    if (!res.ok) throw new Error(`Price lookup returned HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; lowest_price?: string; median_price?: string; volume?: string };
    if (!json.success) throw new Error('No market data for this item');
    const info: PriceInfo = {
      lowest: parsePrice(json.lowest_price),
      median: parsePrice(json.median_price),
      volume: json.volume ? Number(json.volume.replace(/[^\d]/g, '')) : null,
    };
    priceCache.set(key, { at: Date.now(), info });
    return info;
  });
  priceQueue = job.catch(() => undefined);
  return job;
}

// ---------------------------------------------------------------- selling

/** Smallest price a buyer can pay: 1 cent to the seller plus the two 1-cent minimum fees. */
export const MIN_BUYER_PRICE = 3;
/** Refuse anything above this per item, to catch typos (in cents). */
export const MAX_BUYER_PRICE = 50_000;

export interface SellResult {
  assetid: string;
  ok: boolean;
  /** Steam wants the listing approved in the mobile app (or by email). */
  needsConfirmation?: boolean;
  error?: string;
}

function sessionIdOf(cookies: string[]): string {
  const sid = cookies.find((c) => c.startsWith('sessionid='))?.slice('sessionid='.length);
  if (!sid) throw new Error('Steam web session has no sessionid');
  return sid;
}

export async function sellItem(steamId: string, cookies: string[], assetid: string, buyerPrice: number): Promise<SellResult> {
  if (!Number.isInteger(buyerPrice) || buyerPrice < MIN_BUYER_PRICE || buyerPrice > MAX_BUYER_PRICE) {
    return { assetid, ok: false, error: 'Price out of range' };
  }
  const res = await fetch(`${COMMUNITY}/market/sellitem/`, {
    method: 'POST',
    headers: headers(cookies, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: COMMUNITY,
      Referer: `${COMMUNITY}/profiles/${steamId}/inventory/`,
    }),
    body: new URLSearchParams({
      sessionid: sessionIdOf(cookies),
      appid: String(STEAM_APP),
      contextid: String(COMMUNITY_CONTEXT),
      assetid,
      amount: '1',
      // Steam takes what the seller receives; fees are added on top.
      price: String(sellerReceives(buyerPrice)),
    }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  let json: { success?: boolean; message?: string; requires_confirmation?: number; needs_mobile_confirmation?: boolean; needs_email_confirmation?: boolean } = {};
  try {
    json = await res.json();
  } catch {
    // fall through to the status-based error below
  }
  if (!res.ok || !json.success) return { assetid, ok: false, error: json.message || `Steam returned HTTP ${res.status}` };
  return { assetid, ok: true, needsConfirmation: Boolean(json.requires_confirmation || json.needs_mobile_confirmation || json.needs_email_confirmation) };
}

export interface Listing {
  listingid: string;
  name: string;
  icon: string;
  /** What the buyer pays, in cents. */
  buyerPrice: number;
  /** What you receive, in cents. */
  sellerPrice: number;
  /** Waiting for mobile or email confirmation. */
  pending: boolean;
}

interface RawListing {
  listingid: string;
  price: number;
  fee: number;
  asset?: { name?: string; market_hash_name?: string; icon_url?: string };
}

export async function fetchListings(cookies: string[]): Promise<Listing[]> {
  const out: Listing[] = [];
  for (let start = 0; start < 10_000; start += 100) {
    const res = await fetch(`${COMMUNITY}/market/mylistings/?norender=1&count=100&start=${start}`, {
      headers: headers(cookies),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400) throw new Error('Steam web session expired');
    if (!res.ok) throw new Error(`Listings returned HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; total_count?: number; listings?: RawListing[]; listings_to_confirm?: RawListing[] };
    if (!json.success) throw new Error('Steam did not return your listings');
    const map = (l: RawListing, pending: boolean): Listing => ({
      listingid: String(l.listingid),
      name: l.asset?.name ?? l.asset?.market_hash_name ?? 'Item',
      icon: l.asset?.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${l.asset.icon_url}/96fx96f` : '',
      buyerPrice: Number(l.price) + Number(l.fee),
      sellerPrice: Number(l.price),
      pending,
    });
    if (start === 0) out.push(...(json.listings_to_confirm ?? []).map((l) => map(l, true)));
    const page = json.listings ?? [];
    out.push(...page.map((l) => map(l, false)));
    if (page.length < 100 || out.length >= (json.total_count ?? 0)) break;
  }
  return out;
}

export async function removeListing(steamId: string, cookies: string[], listingid: string): Promise<void> {
  if (!/^\d+$/.test(listingid)) throw new Error('Invalid listing ID');
  const res = await fetch(`${COMMUNITY}/market/removelisting/${listingid}`, {
    method: 'POST',
    headers: headers(cookies, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: COMMUNITY,
      Referer: `${COMMUNITY}/market/`,
    }),
    body: new URLSearchParams({ sessionid: sessionIdOf(cookies) }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Steam returned HTTP ${res.status} removing listing ${listingid}`);
}
