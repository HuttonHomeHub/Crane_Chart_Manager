// Backups and restore through the shared kit: one zip holding a consistent snapshot of
// crane.db plus (unless BACKUP_INCLUDE_UPLOADS is off) the uploads folder, written to
// BACKUP_DIR on a schedule and on demand, pruned to BACKUP_KEEP of each kind. The zip
// layout (crane.db at the top, files under uploads/) is the one 1.x wrote, so 1.x
// backups restore here and these restore in 1.x.
import { existsSync } from 'node:fs';
import { readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createBackup,
  restoreBackup,
  startBackupScheduler,
  type BackupContext,
  type BackupSettings,
  type RestoreResult,
  type SchedulerStatus,
} from '@hhh/server';
import { config } from '../config.ts';
import { closeDb, getDb, openDb } from '../db.ts';
import { withLock } from '../lock.ts';
import { logger } from '../logger.ts';
import { backupDir, dbPath, uploadsDir } from '../paths.ts';

export const backupSettings: BackupSettings = {
  prefix: 'crane-backup',
  backupDir,
  dbPath,
  uploadsDir,
  includeUploads: config.backup.includeUploads,
  keep: config.backup.keep,
  maxRestoreBytes: config.backup.maxRestoreBytes,
  requiredTables: ['cranes', 'files'],
};

export const backupContext: BackupContext = { settings: backupSettings, withLock, getDb };

/** Writes a backup into BACKUP_DIR (pruning old ones) and returns its path. */
export function backupNow(): Promise<string> {
  return createBackup(backupContext);
}

/** A one-off backup written to `dir`, for download; nothing is pruned in BACKUP_DIR. */
export function backupTo(dir: string): Promise<string> {
  return createBackup({ ...backupContext, settings: { ...backupSettings, backupDir: dir } });
}

/** Replaces the database and uploads with the zip's, after the kit's checks. */
export function restoreFrom(zipPath: string): Promise<RestoreResult> {
  return restoreBackup(backupContext, zipPath, { closeDb, openDb, logger });
}

// 1.x named backups crane-backup-YYYYMMDD-HHMMSS-ffffff[-prerestore].zip; the kit lists
// and prunes crane-backup-YYYYMMDD-HHMMSS[-label].zip.
const LEGACY_NAME = /^crane-backup-(\d{8}-\d{6})-\d{6}(-prerestore)?\.zip$/;

/**
 * Renames 1.x backups to the kit's names, so they show in Settings, restore by name and
 * are pruned. 1.x still lists the new names, so going back to it loses nothing. A name
 * that is already taken (two backups in the same second) keeps its old name.
 */
export async function renameLegacyBackups(): Promise<string[]> {
  const renamed: string[] = [];
  for (const name of await readdir(backupDir).catch(() => [])) {
    const m = LEGACY_NAME.exec(name);
    if (!m) continue;
    const next = `crane-backup-${m[1] ?? ''}${m[2] ?? ''}.zip`;
    if (existsSync(join(backupDir, next))) continue;
    await rename(join(backupDir, name), join(backupDir, next));
    renamed.push(next);
  }
  if (renamed.length) logger.info({ count: renamed.length }, 'Renamed 1.x backups');
  return renamed;
}

let scheduler: ReturnType<typeof startBackupScheduler> | undefined;

/** Starts the BACKUP_INTERVAL_HOURS schedule (not under test). Returns its stop function. */
export function startBackups(): () => void {
  scheduler = startBackupScheduler({
    enabled: config.backup.enabled,
    intervalHours: config.backup.intervalHours,
    run: () => backupNow(),
    logger,
  });
  return scheduler.stop;
}

export function schedulerStatus(): SchedulerStatus {
  return (
    scheduler?.status() ?? {
      enabled: config.backup.enabled,
      intervalHours: config.backup.intervalHours,
    }
  );
}
