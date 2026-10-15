/**
 * Rules for spotting free Steam licenses in PICS product info, ported from
 * ArchiSteamFarm's FreePackages plugin (Citrinate/FreePackages):
 * free-to-play apps and demos are claimed by app ID, free-on-demand and
 * no-cost packages by package ID.
 */

const BILLING_NO_COST = 0;
const BILLING_FREE_ON_DEMAND = 12;
const PACKAGE_STATUS_AVAILABLE = 0;
const LICENSE_SINGLE_PURCHASE = 1;

/** Steam caps free license activations at about 30 per 90 minutes; stay under it like ASF does. */
export const ACTIVATION_LIMIT = 25;
export const ACTIVATION_PERIOD_MS = 90 * 60_000;

/** Groups shown in the UI; every other app type counts as "other". */
export const LICENSE_CATEGORIES = ['game', 'dlc', 'demo', 'music', 'other'] as const;
export type LicenseCategory = (typeof LICENSE_CATEGORIES)[number];

export interface AppFacts {
  id: number;
  name: string;
  /** Lower-cased PICS type: game, dlc, demo, beta (playtest), music, application, … */
  type: string;
  isFreeApp: boolean;
  releaseState: string;
  state: string;
  parent: number;
  mustOwn: number;
  restrictedCountries: string[] | null;
  purchaseRestrictedCountries: string[] | null;
  allowPurchaseFromRestricted: boolean;
}

export interface PackageFacts {
  id: number;
  billingType: number;
  status: number;
  licenseType: number;
  appids: number[];
  expiryTime: number;
  startTime: number;
  deactivatedDemo: boolean;
  betaTesterPackage: boolean;
  dontGrantIfOwned: number;
  mustOwn: number;
  restrictedCountries: string[] | null;
  onlyAllowRestricted: boolean;
  purchaseRestrictedCountries: string[] | null;
  allowPurchaseFromRestricted: boolean;
}

export interface FreeLicenseCandidate {
  kind: 'app' | 'sub';
  id: number;
  name: string;
  app?: AppFacts;
  pkg?: PackageFacts;
  /** Apps in the package (sub only). */
  contents?: AppFacts[];
}

type KV = Record<string, any> | undefined;

const num = (v: unknown): number => Number(v) || 0;
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
const list = (v: unknown, sep: RegExp): string[] | null =>
  typeof v === 'string' && v.trim() ? v.toUpperCase().split(sep).map((s) => s.trim()).filter(Boolean) : null;

export function categoryOf(type: string): LicenseCategory {
  return (LICENSE_CATEGORIES as readonly string[]).includes(type) && type !== 'other' ? (type as LicenseCategory) : 'other';
}

export function appFacts(id: number, info: KV): AppFacts {
  const common: KV = info?.common;
  const extended: KV = info?.extended;
  return {
    id,
    name: String(common?.name ?? `App ${id}`),
    type: String(common?.type ?? '').toLowerCase(),
    isFreeApp: bool(extended?.isfreeapp),
    releaseState: String(common?.releasestate ?? ''),
    state: String(extended?.state ?? ''),
    parent: num(common?.parent),
    mustOwn: num(extended?.mustownapptopurchase),
    restrictedCountries: list(common?.restricted_countries, /,/),
    purchaseRestrictedCountries: list(extended?.purchaserestrictedcountries, /\s+/),
    allowPurchaseFromRestricted: bool(extended?.allowpurchasefromrestrictedcountries),
  };
}

export function packageFacts(id: number, info: KV): PackageFacts {
  const extended: KV = info?.extended;
  const appids = info?.appids && typeof info.appids === 'object' ? Object.values(info.appids).map(num).filter(Boolean) : [];
  return {
    id,
    billingType: num(info?.billingtype),
    status: num(info?.status),
    licenseType: num(info?.licensetype),
    appids,
    expiryTime: num(extended?.expirytime),
    startTime: num(extended?.starttime),
    deactivatedDemo: bool(extended?.deactivated_demo),
    betaTesterPackage: bool(extended?.betatesterpackage),
    dontGrantIfOwned: num(extended?.dontgrantifappidowned),
    mustOwn: num(extended?.mustownapptopurchase),
    restrictedCountries: list(extended?.restrictedcountries, /\s+/),
    onlyAllowRestricted: bool(extended?.onlyallowrestrictedcountries),
    purchaseRestrictedCountries: list(extended?.purchaserestrictedcountries, /\s+/),
    allowPurchaseFromRestricted: bool(extended?.allowpurchasefromrestrictedcountries),
  };
}

/** Free-to-play apps and demos. Playtests ("beta") need a separate request flow and are left out. */
export function isFreeApp(app: AppFacts): boolean {
  return app.isFreeApp || app.type === 'demo';
}

export function isAvailableApp(app: AppFacts): boolean {
  return ['released', 'preloadonly'].includes(app.releaseState) || app.state === 'eStateAvailable';
}

export function isFreePackage(pkg: PackageFacts): boolean {
  return pkg.billingType === BILLING_FREE_ON_DEMAND || pkg.billingType === BILLING_NO_COST;
}

export function isAvailablePackage(pkg: PackageFacts, nowSec = Date.now() / 1000): boolean {
  if (!pkg.appids.length) return false;
  if (pkg.status !== PACKAGE_STATUS_AVAILABLE) return false;
  if (pkg.licenseType !== LICENSE_SINGLE_PURCHASE) return false;
  if (pkg.expiryTime > 0 && pkg.expiryTime < nowSec) return false;
  if (pkg.deactivatedDemo || pkg.betaTesterPackage) return false;
  // Anonymous Dedicated Server Comp always answers AccessDenied.
  if (pkg.id === 17906) return false;
  return true;
}

/** Every app in the package is known and released (no-cost packages are trusted as-is). */
export function isAvailableContents(pkg: PackageFacts, contents: AppFacts[]): boolean {
  if (pkg.billingType === BILLING_NO_COST) return true;
  return contents.length === pkg.appids.length && contents.every(isAvailableApp);
}

function purchaseBlocked(listed: string[] | null, allowFromListed: boolean, country: string | null): boolean {
  if (!listed || !country) return false;
  return listed.includes(country) !== allowFromListed;
}

export function isRedeemableApp(app: AppFacts, ownedApps: Set<number>, country: string | null, included?: Set<number>, ignoreOwned = false): boolean {
  if (!ignoreOwned && ownedApps.has(app.id)) return false;
  if (app.mustOwn > 0 && !ownedApps.has(app.mustOwn) && !included?.has(app.mustOwn)) return false;
  // DLC can only be added to an account that owns its game.
  if (app.type === 'dlc' && app.parent > 0 && !ownedApps.has(app.parent) && !included?.has(app.parent)) return false;
  if (country && app.restrictedCountries?.includes(country)) return false;
  if (purchaseBlocked(app.purchaseRestrictedCountries, app.allowPurchaseFromRestricted, country)) return false;
  return true;
}

export function isRedeemablePackage(
  pkg: PackageFacts,
  contents: AppFacts[],
  ownedApps: Set<number>,
  ownedPackages: Set<number>,
  country: string | null,
): boolean {
  if (ownedPackages.has(pkg.id)) return false;
  if (pkg.appids.every((id) => ownedApps.has(id))) return false;
  if (pkg.dontGrantIfOwned > 0 && ownedApps.has(pkg.dontGrantIfOwned)) return false;
  if (pkg.mustOwn > 0 && !ownedApps.has(pkg.mustOwn)) return false;
  if (pkg.restrictedCountries && country && pkg.restrictedCountries.includes(country) !== pkg.onlyAllowRestricted) return false;
  if (purchaseBlocked(pkg.purchaseRestrictedCountries, pkg.allowPurchaseFromRestricted, country)) return false;
  const included = new Set(pkg.appids);
  return contents.every((app) => isRedeemableApp(app, ownedApps, country, included, true));
}

/** Is this candidate one of the kinds the account asked for? */
export function isWanted(c: FreeLicenseCandidate, wanted: readonly string[]): boolean {
  const types = c.kind === 'app' ? [c.app!.type] : (c.contents ?? []).map((a) => a.type);
  if (!types.length) return wanted.includes('other');
  return types.some((t) => wanted.includes(categoryOf(t)));
}

/** Label for a package, from its apps' names. */
export function packageName(pkg: PackageFacts, contents: AppFacts[]): string {
  const main = contents.find((a) => a.type === 'game') ?? contents[0];
  if (!main) return `Package ${pkg.id}`;
  return pkg.appids.length > 1 ? `${main.name} (+${pkg.appids.length - 1} more)` : main.name;
}
