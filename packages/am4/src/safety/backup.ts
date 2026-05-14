/**
 * Backup filesystem layer for preset dumps.
 *
 * Saves 12,352-byte preset-dump bytes to `backups/` so they can be
 * restored later if a user override (or our own write tool) clobbers
 * something the user wanted to keep.
 *
 * Filename format: `YYYY-MM-DD-HHMMSS-{location}.syx`. Sortable
 * lexicographically, which makes "restore the most recent" a trivial
 * directory listing + last-element pick.
 *
 * No retention policy — backups accumulate forever in the user's
 * `backups/` directory. Disk usage is ~12 KB per backup; 100 saves
 * ≈ 1.2 MB. Revisit only if it ever becomes a real concern.
 *
 * The directory is gitignored.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_BACKUP_DIR = 'backups';

export interface BackupOptions {
  /** Directory to write backups to. Default: `backups/` relative to cwd. */
  readonly dir?: string;
  /** Override the timestamp clock (testing). Default: `() => new Date()`. */
  readonly now?: () => Date;
}

export interface BackupRecord {
  readonly location: string;
  readonly path: string;
  readonly timestamp: string; // YYYY-MM-DD-HHMMSS
}

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, '0');
}

function formatTimestamp(d: Date): string {
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * Write a backup of a location's bytes. Returns the path written and
 * the timestamp used. Creates the backup directory if it doesn't exist.
 */
export function writeBackup(
  location: string,
  bytes: Uint8Array,
  opts: BackupOptions = {},
): BackupRecord {
  const dir = opts.dir ?? DEFAULT_BACKUP_DIR;
  const now = opts.now?.() ?? new Date();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const timestamp = formatTimestamp(now);
  const filename = `${timestamp}-${location}.syx`;
  const path = join(dir, filename);
  writeFileSync(path, bytes);
  return { location, path, timestamp };
}

/**
 * List all backups for `location`, newest first. Returns an empty array
 * if the directory doesn't exist or no matching files are present.
 */
export function listBackups(
  location: string,
  opts: Pick<BackupOptions, 'dir'> = {},
): BackupRecord[] {
  const dir = opts.dir ?? DEFAULT_BACKUP_DIR;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir);
  const pattern = new RegExp(
    `^(\\d{4}-\\d{2}-\\d{2}-\\d{6})-${location}\\.syx$`,
  );
  const records: BackupRecord[] = [];
  for (const f of files) {
    const m = pattern.exec(f);
    if (m) records.push({ location, path: join(dir, f), timestamp: m[1] });
  }
  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return records;
}

/** Read backup bytes from disk. Throws if the path doesn't exist. */
export function readBackup(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
