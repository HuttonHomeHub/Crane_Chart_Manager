// Backups and restore, the same in every app.
//
// A backup is one zip: a consistent snapshot of the database (SQLite's online backup
// API, safe while the app runs) plus, unless includeUploads is off, the uploads
// folder. Written as <prefix>-YYYYMMDD-HHMMSS[-label].zip into backupDir, then pruned
// to `keep` per kind (scheduled, prerestore ...).
//
// A restore never touches live data until the archive has passed every check: entry
// names (no absolute paths, no "..", only the database and uploads/), total size
// (declared and actually written, against zip bombs), and the database itself (SQLite
// integrity check and the app's required tables). Then a "prerestore" safety backup is
// taken, and under the write lock the uploads are swapped first and the database last.
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import yauzl from 'yauzl';
import yazl from 'yazl';
export class RestoreError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'RestoreError';
    }
}
const UPLOADS_PREFIX = 'uploads/';
function stamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}
export function backupName(prefix, date, label) {
    return `${prefix}-${stamp(date)}${label ? `-${label}` : ''}.zip`;
}
function nameRe(prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}-\\d{8}-\\d{6}(?:-([a-z]+))?\\.zip$`);
}
/** Only names this app wrote can be downloaded or restored by name (no paths). */
export function isBackupName(prefix, name) {
    return nameRe(prefix).test(name);
}
async function listTree(dir) {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch((err) => {
        if (err.code === 'ENOENT')
            return [];
        throw err;
    });
    return entries
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
        .sort();
}
export async function listBackups(settings) {
    const re = nameRe(settings.prefix);
    const names = (await readdir(settings.backupDir).catch(() => [])).filter((n) => re.test(n));
    const infos = await Promise.all(names.map(async (name) => {
        const s = await stat(join(settings.backupDir, name));
        return { name, size: s.size, createdAt: s.mtime };
    }));
    return infos.sort((a, b) => b.name.localeCompare(a.name));
}
/** Keeps the newest `keep` backups of each kind (unlabelled, prerestore, ...). */
export async function pruneBackups(settings) {
    const re = nameRe(settings.prefix);
    const groups = new Map();
    for (const { name } of await listBackups(settings)) {
        const label = re.exec(name)?.[1] ?? '';
        groups.set(label, [...(groups.get(label) ?? []), name]);
    }
    const removed = [];
    for (const names of groups.values()) {
        for (const name of names.slice(settings.keep)) {
            await unlink(join(settings.backupDir, name));
            removed.push(name);
        }
    }
    return removed;
}
export async function createBackup(ctx, options = {}) {
    const { settings } = ctx;
    await mkdir(settings.backupDir, { recursive: true });
    const final = join(settings.backupDir, backupName(settings.prefix, options.now ?? new Date(), options.label));
    const partial = `${final}.partial`;
    const snapshot = join(settings.backupDir, `.snapshot-${process.pid}-${Date.now()}.db`);
    try {
        await ctx.withLock(async () => {
            await ctx.getDb().backup(snapshot);
            const zip = new yazl.ZipFile();
            zip.addFile(snapshot, basename(settings.dbPath));
            if (settings.includeUploads) {
                for (const file of await listTree(settings.uploadsDir)) {
                    zip.addFile(join(settings.uploadsDir, file), `${UPLOADS_PREFIX}${file}`);
                }
            }
            zip.end();
            await pipeline(zip.outputStream, createWriteStream(partial));
        });
        await rename(partial, final);
    }
    finally {
        await rm(snapshot, { force: true });
        await rm(partial, { force: true });
    }
    await pruneBackups(settings);
    return final;
}
function openZip(path) {
    return new Promise((done, fail) => yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => err || !zip ? fail(err ?? new Error('could not open')) : done(zip)));
}
function safeEntryName(name) {
    return (!name.startsWith('/') &&
        !name.includes('\\') &&
        !/^[a-zA-Z]:/.test(name) &&
        !name.split('/').some((part) => part === '..'));
}
/** Walks every entry, calling `onFile` for files; rejects anything unsafe or too big. */
async function walkArchive(path, settings, onFile) {
    const dbName = basename(settings.dbPath);
    let zip;
    try {
        zip = await openZip(path);
    }
    catch (err) {
        throw new RestoreError(`not a valid backup archive: ${err.message}`, { cause: err });
    }
    let total = 0;
    let hasDb = false;
    let hasUploads = false;
    try {
        await new Promise((done, fail) => {
            zip.on('error', fail);
            zip.on('end', done);
            zip.on('entry', (entry) => {
                void (async () => {
                    const name = entry.fileName;
                    if (!safeEntryName(name))
                        throw new RestoreError(`unsafe path in backup: ${name}`);
                    const isDir = name.endsWith('/');
                    if (name === dbName)
                        hasDb = true;
                    else if (name.startsWith(UPLOADS_PREFIX))
                        hasUploads = hasUploads || !isDir;
                    else
                        throw new RestoreError(`unexpected file in backup: ${name}`);
                    total += entry.uncompressedSize;
                    if (total > settings.maxRestoreBytes)
                        throw new RestoreError('backup is too large to restore');
                    if (!isDir && onFile)
                        await onFile(entry, zip);
                    zip.readEntry();
                })().catch(fail);
            });
            zip.readEntry();
        });
    }
    catch (err) {
        if (err instanceof RestoreError)
            throw err;
        throw new RestoreError(`not a valid backup archive: ${err.message}`, { cause: err });
    }
    finally {
        zip.close();
    }
    if (!hasDb)
        throw new RestoreError(`backup has no ${dbName}`);
    return { hasDb, hasUploads };
}
function readStream(zip, entry) {
    return new Promise((done, fail) => zip.openReadStream(entry, (err, stream) => err || !stream ? fail(err ?? new Error('unreadable')) : done(stream)));
}
async function extract(path, settings, dest) {
    let written = 0;
    return walkArchive(path, settings, async (entry, zip) => {
        const target = join(dest, entry.fileName);
        if (!target.startsWith(dest + sep))
            throw new RestoreError(`unsafe path in backup: ${entry.fileName}`);
        await mkdir(dirname(target), { recursive: true });
        const counter = new Transform({
            transform(chunk, _enc, next) {
                written += chunk.length;
                if (written > settings.maxRestoreBytes)
                    next(new RestoreError('backup is too large to restore'));
                else
                    next(null, chunk);
            },
        });
        await pipeline(await readStream(zip, entry), counter, createWriteStream(target));
    });
}
function checkDatabase(path, requiredTables) {
    let db;
    try {
        db = new Database(path, { readonly: true, fileMustExist: true });
        const result = db.pragma('integrity_check', { simple: true });
        if (result !== 'ok')
            throw new Error(`integrity check: ${String(result)}`);
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
        const missing = requiredTables.filter((t) => !tables.has(t));
        if (missing.length)
            throw new Error(`missing tables: ${missing.join(', ')}`);
    }
    catch (err) {
        throw new RestoreError(`the backup's database is not usable: ${err.message}`, {
            cause: err,
        });
    }
    finally {
        db?.close();
    }
}
async function exists(path) {
    return stat(path).then(() => true, () => false);
}
/** Rename, or copy and delete when the two are on different disks (uploads on a NAS). */
async function moveDir(src, dest) {
    try {
        await rename(src, dest);
    }
    catch (err) {
        if (err.code !== 'EXDEV')
            throw err;
        await cp(src, dest, { recursive: true });
        await rm(src, { recursive: true, force: true });
    }
}
export async function restoreBackup(ctx, zipPath, hooks) {
    const { settings } = ctx;
    const dbName = basename(settings.dbPath);
    await walkArchive(zipPath, settings); // cheap first pass: names and declared sizes
    const staging = await mkdtemp(join(dirname(settings.dbPath), '.restore-'));
    try {
        const { hasUploads } = await extract(zipPath, settings, staging);
        checkDatabase(join(staging, dbName), settings.requiredTables);
        const safetyBackup = basename(await createBackup(ctx, { label: 'prerestore' }));
        await ctx.withLock(async () => {
            hooks.closeDb();
            const oldUploads = join(staging, '.previous-uploads');
            let uploadsSwapped = false;
            try {
                if (hasUploads) {
                    if (await exists(settings.uploadsDir))
                        await moveDir(settings.uploadsDir, oldUploads);
                    await moveDir(join(staging, 'uploads'), settings.uploadsDir);
                    uploadsSwapped = true;
                }
                await rm(`${settings.dbPath}-wal`, { force: true });
                await rm(`${settings.dbPath}-shm`, { force: true });
                await rename(join(staging, dbName), settings.dbPath);
            }
            catch (err) {
                if (uploadsSwapped && (await exists(oldUploads))) {
                    await rm(settings.uploadsDir, { recursive: true, force: true });
                    await moveDir(oldUploads, settings.uploadsDir);
                }
                throw err;
            }
            finally {
                hooks.openDb();
            }
        });
        hooks.logger?.info({ from: basename(zipPath), safetyBackup, restoredUploads: hasUploads }, 'Restored a backup');
        return { safetyBackup, restoredUploads: hasUploads };
    }
    finally {
        await rm(staging, { recursive: true, force: true });
    }
}
/**
 * Runs `run` every intervalHours; the first run comes after five minutes (or the
 * interval, if shorter), so a restart loop doesn't back up on every start.
 */
export function startBackupScheduler(options) {
    const state = { enabled: options.enabled, intervalHours: options.intervalHours };
    const intervalMs = options.intervalHours * 3_600_000;
    let timer;
    const schedule = (delay) => {
        state.nextRunAt = new Date(Date.now() + delay).toISOString();
        timer = setTimeout(() => void tick(), delay);
        timer.unref();
    };
    const tick = async () => {
        try {
            await options.run();
            state.lastSuccessAt = new Date().toISOString();
            delete state.lastError;
        }
        catch (err) {
            state.lastError = err.message;
            options.logger.error({ err }, 'Scheduled backup failed');
        }
        schedule(intervalMs);
    };
    if (options.enabled)
        schedule(Math.min(300_000, intervalMs));
    return {
        stop: () => {
            if (timer)
                clearTimeout(timer);
            delete state.nextRunAt;
        },
        status: () => ({ ...state }),
    };
}
