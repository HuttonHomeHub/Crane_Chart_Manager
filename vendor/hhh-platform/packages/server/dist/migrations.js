// Numbered SQL migrations, recorded in schema_migrations with each file's checksum.
//   migrations/001-init.sql, 002-add-labels.sql, ...
// Each runs in its own transaction; a failure rolls that one back and stops startup.
// Before migrating a database that already holds data, a consistent copy is written
// (VACUUM INTO) so a bad migration can be undone. A released migration must never be
// edited: if a recorded file's checksum changes, startup stops and says which.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userTables } from "./db.js";
const FILE_RE = /^(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/;
export class MigrationError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'MigrationError';
    }
}
export function readMigrations(dir) {
    const migrations = readdirSync(dir)
        .filter((file) => file.endsWith('.sql'))
        .map((file) => {
        const m = FILE_RE.exec(file);
        if (!m)
            throw new MigrationError(`${file}: migration files are named NNN-kebab-case.sql`);
        const sql = readFileSync(join(dir, file), 'utf8');
        return {
            version: Number(m[1]),
            name: file,
            sql,
            checksum: createHash('sha256').update(sql).digest('hex'),
        };
    })
        .sort((a, b) => a.version - b.version);
    for (let i = 1; i < migrations.length; i++) {
        const [prev, cur] = [migrations[i - 1], migrations[i]];
        if (prev && cur && prev.version === cur.version) {
            throw new MigrationError(`${prev.name} and ${cur.name} share version ${cur.version}`);
        }
    }
    return migrations;
}
export function runMigrations(db, options) {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
    const applied = new Map(db.prepare('SELECT version, name, checksum FROM schema_migrations').all().map((row) => [row.version, row]));
    const migrations = readMigrations(options.dir);
    for (const m of migrations) {
        const done = applied.get(m.version);
        if (done && done.checksum !== m.checksum) {
            throw new MigrationError(`${m.name} changed after it was applied; add a new migration instead`);
        }
    }
    const pending = migrations.filter((m) => !applied.has(m.version));
    const result = { applied: [] };
    if (pending.length === 0)
        return result;
    const hasData = userTables(db).some((t) => t !== 'schema_migrations');
    if (hasData) {
        mkdirSync(options.backupDir, { recursive: true });
        const stamp = (options.now?.() ?? new Date())
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..*/, '');
        result.backup = join(options.backupDir, `premigrate-${stamp}.db`);
        db.prepare('VACUUM INTO ?').run(result.backup);
        options.logger?.info({ backup: result.backup }, 'Copied the database before migrating');
    }
    const record = db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)');
    for (const m of pending) {
        try {
            db.transaction(() => {
                db.exec(m.sql);
                record.run(m.version, m.name, m.checksum, new Date().toISOString());
            })();
        }
        catch (err) {
            throw new MigrationError(`${m.name} failed: ${err.message}`, { cause: err });
        }
        result.applied.push(m.name);
        options.logger?.info({ migration: m.name }, 'Applied migration');
    }
    return result;
}
