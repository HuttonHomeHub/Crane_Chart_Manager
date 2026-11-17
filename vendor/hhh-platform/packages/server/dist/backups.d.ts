import Database from 'better-sqlite3';
import type { Logger } from './logger.ts';
import type { WithLock } from './lock.ts';
export interface BackupSettings {
    /** File-name prefix, e.g. 'crane-backup'. */
    prefix: string;
    backupDir: string;
    dbPath: string;
    uploadsDir: string;
    includeUploads: boolean;
    keep: number;
    maxRestoreBytes: number;
    /** Tables a backup's database must contain to be restorable. */
    requiredTables: string[];
}
export interface BackupContext {
    settings: BackupSettings;
    withLock: WithLock;
    /** The live database handle (it changes after a restore). */
    getDb: () => Database.Database;
}
export declare class RestoreError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
export declare function backupName(prefix: string, date: Date, label?: string): string;
/** Only names this app wrote can be downloaded or restored by name (no paths). */
export declare function isBackupName(prefix: string, name: string): boolean;
export interface BackupInfo {
    name: string;
    size: number;
    createdAt: Date;
}
export declare function listBackups(settings: BackupSettings): Promise<BackupInfo[]>;
/** Keeps the newest `keep` backups of each kind (unlabelled, prerestore, ...). */
export declare function pruneBackups(settings: BackupSettings): Promise<string[]>;
export declare function createBackup(ctx: BackupContext, options?: {
    label?: string;
    now?: Date;
}): Promise<string>;
export interface RestoreHooks {
    /** Close the live database handle before its file is replaced. */
    closeDb: () => void;
    /** Open it again afterwards (also called if the swap fails). */
    openDb: () => void;
    logger?: Logger;
}
export interface RestoreResult {
    safetyBackup: string;
    restoredUploads: boolean;
}
export declare function restoreBackup(ctx: BackupContext, zipPath: string, hooks: RestoreHooks): Promise<RestoreResult>;
export interface SchedulerStatus {
    enabled: boolean;
    intervalHours: number;
    lastSuccessAt?: string;
    lastError?: string;
    nextRunAt?: string;
}
/**
 * Runs `run` every intervalHours; the first run comes after five minutes (or the
 * interval, if shorter), so a restart loop doesn't back up on every start.
 */
export declare function startBackupScheduler(options: {
    enabled: boolean;
    intervalHours: number;
    run: () => Promise<unknown>;
    logger: Logger;
}): {
    stop: () => void;
    status: () => SchedulerStatus;
};
