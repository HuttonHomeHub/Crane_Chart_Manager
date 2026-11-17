import type { Database } from 'better-sqlite3';
import type { Logger } from './logger.ts';
export declare class MigrationError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
export interface Migration {
    version: number;
    name: string;
    sql: string;
    checksum: string;
}
export declare function readMigrations(dir: string): Migration[];
export interface MigrationResult {
    applied: string[];
    /** Path of the pre-migration copy, when one was taken. */
    backup?: string;
}
export declare function runMigrations(db: Database, options: {
    dir: string;
    backupDir: string;
    logger?: Logger;
    now?: () => Date;
}): MigrationResult;
