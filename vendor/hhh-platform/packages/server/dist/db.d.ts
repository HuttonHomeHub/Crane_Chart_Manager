import Database from 'better-sqlite3';
export type { Database } from 'better-sqlite3';
export declare function openDatabase(path: string, options?: {
    readonly?: boolean;
}): Database.Database;
/** For /ready: throws if the database can't answer. */
export declare function pingDatabase(db: Database.Database): void;
/** The app's own tables (SQLite's internal ones excluded). */
export declare function userTables(db: Database.Database): string[];
