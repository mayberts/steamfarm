import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

function chownRecursive(target: string, uid: number, gid: number): void {
  fs.lchownSync(target, uid, gid);
  if (fs.lstatSync(target).isDirectory()) {
    for (const entry of fs.readdirSync(target)) chownRecursive(path.join(target, entry), uid, gid);
  }
}

/**
 * When the container starts as root, hand the data directory to PUID:PGID and
 * switch to that user. This lets /data be a host folder owned by anyone
 * (on Unraid: PUID=99, PGID=100). Does nothing when not running as root.
 */
export function dropPrivileges(): void {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const uid = Number.parseInt(process.env.PUID ?? '1000', 10);
  const gid = Number.parseInt(process.env.PGID ?? '1000', 10);
  if (uid === 0) return; // explicitly asked to run as root

  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    chownRecursive(config.dataDir, uid, gid);
  } catch (err) {
    console.warn(`Could not change the owner of ${config.dataDir} to ${uid}:${gid}: ${(err as Error).message}`);
  }
  process.setgroups?.([gid]);
  process.setgid!(gid);
  process.setuid!(uid);
}
