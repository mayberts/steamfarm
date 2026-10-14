import BinaryKVParser from 'binarykvparser';
import Schema from 'steam-user/protobufs/generated/_load.js';

// Steam client message IDs (EMsg) for the user stats protocol.
const EMSG_CLIENT_GET_USER_STATS = 818;
const EMSG_CLIENT_STORE_USER_STATS2 = 5466;

const ERESULT_OK = 1;
const REQUEST_TIMEOUT_MS = 20_000;

export interface Achievement {
  /** API name, e.g. "ACH_WIN_ONE_GAME". */
  name: string;
  displayName: string;
  description: string;
  hidden: boolean;
  unlocked: boolean;
  /** Unix seconds; 0 when locked. */
  unlockTime: number;
  /** Protected achievements can only be set by the game's servers. */
  protected: boolean;
  icon: string;
  iconGray: string;
  /** Global unlock percentage, when known. */
  percent?: number;
  statId: number;
  bit: number;
}

export interface UserStats {
  appid: number;
  crcStats: number;
  achievements: Achievement[];
  /** Current value of every achievement bitfield stat, keyed by stat ID. */
  bitfields: Map<number, number>;
}

/** The subset of the steam-user client this module relies on. */
export interface SteamClientLike {
  steamID: { getSteamID64(): string } | null;
  _send(header: { msg: number; proto: object }, body: Buffer, cb?: (body: unknown) => void): void;
}

function toBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  const maybe = body as { toBuffer?: () => Buffer };
  if (maybe && typeof maybe.toBuffer === 'function') return maybe.toBuffer();
  throw new Error('Unexpected message body');
}

function request(client: SteamClientLike, emsg: number, protoName: string, body: object, responseProto: string): Promise<any> {
  const Req = Schema[protoName];
  const Res = Schema[responseProto];
  const encoded: Buffer = Req.encode(body).finish();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Steam')), REQUEST_TIMEOUT_MS);
    client._send({ msg: emsg, proto: {} }, encoded, (resBody) => {
      clearTimeout(timer);
      try {
        const decoded = Res.decode(toBuffer(resBody));
        resolve(Res.toObject(decoded, { longs: String, defaults: true, bytes: Buffer }));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function localized(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.english === 'string') return obj.english;
    const first = Object.entries(obj).find(([k, v]) => k !== 'token' && typeof v === 'string');
    if (first) return first[1] as string;
  }
  return '';
}

const ACHIEVEMENT_STAT_TYPES = new Set(['4', '5', 'ACHIEVEMENTS', 'GROUPACHIEVEMENTS']);

interface AchievementBlock {
  achievement_id: number;
  unlock_time: number[];
}

/**
 * Turn the binary KeyValues stats schema plus the user's unlock blocks into a
 * flat achievement list. Exported for tests.
 */
export function parseSchema(appid: number, schema: any, blocks: AchievementBlock[]): Omit<UserStats, 'crcStats'> {
  const root = schema?.[String(appid)] ?? Object.values(schema ?? {})[0];
  const stats = root?.stats ?? {};
  const unlockTimes = new Map<number, number[]>();
  for (const block of blocks) unlockTimes.set(Number(block.achievement_id), block.unlock_time ?? []);

  const achievements: Achievement[] = [];
  const bitfields = new Map<number, number>();
  const iconBase = `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/`;

  for (const [statKey, stat] of Object.entries<any>(stats)) {
    if (!ACHIEVEMENT_STAT_TYPES.has(String(stat?.type ?? stat?.type_int ?? ''))) continue;
    const statId = Number(stat.id ?? statKey);
    const times = unlockTimes.get(statId) ?? [];
    let value = 0;
    for (const [bitKey, bitDef] of Object.entries<any>(stat.bits ?? {})) {
      const bit = Number(bitDef?.bit ?? bitKey);
      if (!Number.isInteger(bit) || bit < 0 || bit > 31) continue;
      const unlockTime = Number(times[bit] ?? 0);
      if (unlockTime > 0) value |= 1 << bit;
      const display = bitDef.display ?? {};
      achievements.push({
        name: String(bitDef.name ?? `${statId}_${bit}`),
        displayName: localized(display.name) || String(bitDef.name ?? ''),
        description: localized(display.desc),
        hidden: String(display.hidden ?? '0') === '1',
        unlocked: unlockTime > 0,
        unlockTime,
        protected: Number(bitDef.permission ?? 0) >= 2,
        icon: display.icon ? iconBase + display.icon : '',
        iconGray: display.icon_gray ? iconBase + display.icon_gray : '',
        statId,
        bit,
      });
    }
    bitfields.set(statId, value >>> 0);
  }

  return { appid, achievements, bitfields };
}

export async function getUserStats(client: SteamClientLike, appid: number): Promise<UserStats> {
  if (!client.steamID) throw new Error('Account is not logged in');
  const res = await request(
    client,
    EMSG_CLIENT_GET_USER_STATS,
    'CMsgClientGetUserStats',
    { game_id: appid, crc_stats: 0, schema_local_version: -1, steam_id_for_user: client.steamID.getSteamID64() },
    'CMsgClientGetUserStatsResponse',
  );
  if (res.eresult !== ERESULT_OK) throw new Error(`Steam returned EResult ${res.eresult} for app ${appid}`);
  if (!res.schema || res.schema.length === 0) {
    return { appid, crcStats: res.crc_stats, achievements: [], bitfields: new Map() };
  }
  const schema = BinaryKVParser.parse(res.schema);
  const parsed = parseSchema(appid, schema, res.achievement_blocks ?? []);
  return { ...parsed, crcStats: res.crc_stats };
}

/**
 * Lock or unlock achievements. `changes` maps API name to the desired state.
 * Returns the names actually changed.
 */
export async function setAchievements(
  client: SteamClientLike,
  appid: number,
  changes: Record<string, boolean>,
): Promise<string[]> {
  if (!client.steamID) throw new Error('Account is not logged in');
  const current = await getUserStats(client, appid);
  const bitfields = new Map(current.bitfields);
  const changed: string[] = [];
  const touched = new Set<number>();

  for (const ach of current.achievements) {
    if (!(ach.name in changes) || changes[ach.name] === ach.unlocked) continue;
    if (ach.protected) throw new Error(`"${ach.displayName}" is protected and can only be set by the game's servers`);
    let value = bitfields.get(ach.statId) ?? 0;
    value = changes[ach.name] ? value | (1 << ach.bit) : value & ~(1 << ach.bit);
    bitfields.set(ach.statId, value >>> 0);
    touched.add(ach.statId);
    changed.push(ach.name);
  }
  if (changed.length === 0) return [];

  const steamId = client.steamID.getSteamID64();
  const res = await request(
    client,
    EMSG_CLIENT_STORE_USER_STATS2,
    'CMsgClientStoreUserStats2',
    {
      game_id: appid,
      settor_steam_id: steamId,
      settee_steam_id: steamId,
      crc_stats: current.crcStats,
      explicit_reset: false,
      stats: [...touched].map((id) => ({ stat_id: id, stat_value: bitfields.get(id) })),
    },
    'CMsgClientStoreUserStatsResponse',
  );
  if (res.eresult !== ERESULT_OK) throw new Error(`Steam rejected the change (EResult ${res.eresult})`);
  return changed;
}

/** Global unlock percentages from the public Web API (no key required). */
export async function getGlobalPercentages(appid: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return out;
    const json = (await res.json()) as { achievementpercentages?: { achievements?: { name: string; percent: number | string }[] } };
    for (const a of json.achievementpercentages?.achievements ?? []) out.set(a.name, Number(a.percent));
  } catch {
    // Percentages are cosmetic; ignore network failures.
  }
  return out;
}
