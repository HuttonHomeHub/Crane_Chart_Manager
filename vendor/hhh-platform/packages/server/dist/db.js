// Opens the app's SQLite database the same way everywhere: WAL (readers don't block
// the writer), foreign keys enforced, and a busy timeout instead of instant failure.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
export function openDatabase(path, options = {}) {
    if (!options.readonly)
        mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, options.readonly ? { readonly: true, fileMustExist: true } : {});
    if (!options.readonly)
        db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
}
/** For /ready: throws if the database can't answer. */
export function pingDatabase(db) {
    db.prepare('SELECT 1').get();
}
/** The app's own tables (SQLite's internal ones excluded). */
export function userTables(db) {
    return db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all().map((row) => row.name);
}
