import type { Bot } from './bot';
import {
  appFacts,
  AppFacts,
  FreeLicenseCandidate,
  isAvailableApp,
  isAvailableContents,
  isAvailablePackage,
  isFreeApp,
  isFreePackage,
  packageFacts,
  packageName,
} from './licenses';
import { appLog } from './log';
import { store } from './store';

const CHECK_INTERVAL_MS = 5 * 60_000;
/** On the very first run, look this many change numbers back (roughly a couple of days). */
const FIRST_RUN_BACKLOG = 20_000;
const BATCH = 200;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Product info for many apps/packages, in batches Steam is happy with. */
export async function productInfo(client: any, appids: number[], packageids: number[]) {
  const apps: Record<string, any> = {};
  const packages: Record<string, any> = {};
  for (const batch of chunks(appids, BATCH)) {
    const res = await client.getProductInfo(batch, [], true);
    for (const [id, v] of Object.entries(res.apps ?? {})) apps[id] = (v as any).appinfo;
  }
  for (const batch of chunks(packageids, BATCH)) {
    const res = await client.getProductInfo([], batch, true);
    for (const [id, v] of Object.entries(res.packages ?? {})) packages[id] = (v as any).packageinfo;
  }
  return { apps, packages };
}

/**
 * Follows Steam's PICS change feed (the same one SteamDB and ASF use) and hands every
 * newly free app or package to the accounts that have free license claiming turned on.
 */
export class FreeLicenseWatcher {
  lastCheck = 0;
  message = '';
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly bots: () => Bot[]) {}

  start(): void {
    this.schedule(30_000);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check().catch(() => {}), ms);
  }

  get changeNumber(): number {
    return store.raw.licenses?.changeNumber ?? 0;
  }

  private wanting(): Bot[] {
    return this.bots().filter((b) => b.account.freeLicenses.enabled && b.status === 'online');
  }

  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const bots = this.wanting();
      const client = bots[0]?.steamClient;
      if (!client) {
        this.message = 'Waiting for an online account with free license claiming on';
        return;
      }
      const since = this.changeNumber;
      const head = since ? null : (await client.getProductChanges(0)).currentChangeNumber;
      const from = since || Math.max(1, head - FIRST_RUN_BACKLOG);
      const changes = await client.getProductChanges(from);
      const appids = [...new Set<number>((changes.appChanges ?? []).map((c: any) => Number(c.appid)))];
      const packageids = [...new Set<number>((changes.packageChanges ?? []).map((c: any) => Number(c.packageid)))];

      const found = await this.findFree(client, appids, packageids);
      for (const bot of bots) await bot.queueFreeLicenses(found).catch((err) => bot.log.warn(`Free licenses: ${(err as Error).message}`));

      store.raw.licenses = { changeNumber: changes.currentChangeNumber };
      store.save();
      this.lastCheck = Date.now();
      this.message = `Checked ${appids.length} app and ${packageids.length} package change(s); ${found.length} free`;
      if (found.length) appLog.info(`Free licenses: ${this.message}`);
    } catch (err) {
      this.message = `Check failed: ${(err as Error).message}`;
      appLog.warn(`Free licenses: ${this.message}`);
    } finally {
      this.running = false;
      this.schedule(CHECK_INTERVAL_MS);
    }
  }

  private async findFree(client: any, appids: number[], packageids: number[]): Promise<FreeLicenseCandidate[]> {
    const info = await productInfo(client, appids, packageids);
    const found: FreeLicenseCandidate[] = [];

    for (const [id, appinfo] of Object.entries(info.apps)) {
      const app = appFacts(Number(id), appinfo);
      if (isFreeApp(app) && isAvailableApp(app)) found.push({ kind: 'app', id: app.id, name: app.name, app });
    }

    const pkgs = Object.entries(info.packages)
      .map(([id, p]) => packageFacts(Number(id), p))
      .filter((p) => isFreePackage(p) && isAvailablePackage(p));
    if (pkgs.length) {
      const contentIds = [...new Set(pkgs.flatMap((p) => p.appids))];
      const contentInfo = (await productInfo(client, contentIds, [])).apps;
      for (const pkg of pkgs) {
        const contents: AppFacts[] = pkg.appids.filter((id) => contentInfo[id]).map((id) => appFacts(id, contentInfo[id]));
        if (!isAvailableContents(pkg, contents)) continue;
        found.push({ kind: 'sub', id: pkg.id, name: packageName(pkg, contents), pkg, contents });
      }
    }
    return found;
  }
}
