// The crane catalogue's API, the same routes and JSON as 1.x. Every change runs inside
// withLock, so a crane's folder under uploads/ and its database rows always move together.
import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { HttpError, rateLimiter } from '@hhh/server';
import type {
  CatalogueExport,
  CranePage,
  CraneReply,
  DeleteFileReply,
  MergeReply,
  MetadataReply,
} from '../../shared/api.ts';
import { config } from '../config.ts';
import {
  auditSnapshot,
  craneDir,
  facets,
  getCrane,
  listCranes,
  logEvent,
  type FileRow,
} from '../cranes.ts';
import { getDb } from '../db.ts';
import { withLock } from '../lock.ts';
import {
  dedupeStoredName,
  generateCraneId,
  isoNow,
  secureFilename,
  storedNameFor,
} from '../names.ts';

export const cranesRouter = Router();

const uploadLimit = rateLimiter(config.uploadRate);
const writeLimit = rateLimiter(config.writeRate);

// Uploaded PDFs wait in the temporary folder until they are checked, then move into
// their crane's folder. Filenames are read as UTF-8, as browsers send them.
const pdfUpload = multer({
  dest: tmpdir(),
  defParamCharset: 'utf8',
  limits: { fileSize: config.maxUploadBytes, files: 1 },
}).single('file');

const MAX_UPLOAD_MB = Math.floor(config.maxUploadBytes / (1024 * 1024));

/** pdfUpload, with 1.x's message for a file over MAX_UPLOAD_MB. */
const receivePdf: RequestHandler = (req, res, next) => {
  pdfUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(
        err.code === 'LIMIT_FILE_SIZE'
          ? new HttpError(413, `File too large. Maximum upload size is ${MAX_UPLOAD_MB} MB.`)
          : new HttpError(400, err.message)
      );
      return;
    }
    next(err);
  });
};

/** Removes the temporary upload whatever the route did with it. */
const cleanUpUpload: RequestHandler = (req, res, next) => {
  res.on('close', () => {
    if (req.file) void rm(req.file.path, { force: true });
  });
  next();
};

/** Moves a file, copying when the two folders are on different filesystems. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

/** The uploaded file, once it is known to be a PDF by its name and its first bytes. */
async function checkedPdf(file: Express.Multer.File | undefined): Promise<Express.Multer.File> {
  if (!file) throw new HttpError(400, 'No file part');
  if (file.originalname === '') throw new HttpError(400, 'No selected file');
  const dot = file.originalname.lastIndexOf('.');
  if (dot < 0 || file.originalname.slice(dot + 1).toLowerCase() !== 'pdf')
    throw new HttpError(400, 'Only PDF files are allowed');
  const handle = await open(file.path, 'r');
  try {
    const head = Buffer.alloc(5);
    await handle.read(head, 0, 5, 0);
    if (head.toString('latin1') !== '%PDF-') throw new HttpError(400, 'Only PDF files are allowed');
  } finally {
    await handle.close();
  }
  return file;
}

/** 400 when a value is longer than MAX_FIELD_LEN characters. */
function capField(value: string, name: string): string {
  if ([...value].length > config.maxFieldLen)
    throw new HttpError(400, `${name} is too long (max ${config.maxFieldLen} characters).`);
  return value;
}

type Body = Record<string, unknown>;
const bodyOf = (req: { body?: unknown }): Body =>
  typeof req.body === 'object' && req.body !== null ? (req.body as Body) : {};
/** A JSON string field, trimmed; anything else counts as empty. */
const text = (body: Body, key: string): string => {
  const v = body[key];
  return typeof v === 'string' ? v.trim() : '';
};

function mustGetCrane(id: string, message = 'Crane not found') {
  const crane = getCrane(id);
  if (!crane) throw new HttpError(404, message);
  return crane;
}

/** The numeric file id in the path, as Flask's <int:…> matched it (404 otherwise). */
function fileIdParam(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) throw new HttpError(404, 'Not found');
  return Number(raw);
}

/** Moves a checked upload into the crane's folder under a free name; returns that name. */
async function placeFile(craneId: string, file: Express.Multer.File): Promise<string> {
  const dir = craneDir(craneId);
  await mkdir(dir, { recursive: true });
  const stored = dedupeStoredName(dir, storedNameFor(file.originalname));
  await moveFile(file.path, join(dir, stored));
  return stored;
}

/** Adds a file row; returns its id. */
function insertFile(craneId: string, stored: string, original: string, label: string, now: string) {
  const result = getDb()
    .prepare(
      `INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(craneId, stored, secureFilename(original), label, now);
  return Number(result.lastInsertRowid);
}

// Every crane with its files. ?after=<crane id>&limit=<n> pages through them in id order;
// with no limit, all of them come back and next_cursor is null.
cranesRouter.get('/pdfs', (req, res) => {
  const after = typeof req.query.after === 'string' ? req.query.after : '';
  const limit = Number.parseInt(typeof req.query.limit === 'string' ? req.query.limit : '', 10);
  const all = listCranes();
  let rest = all;
  if (after) {
    const i = all.findIndex((c) => c.id === after);
    if (i >= 0) rest = all.slice(i + 1);
  }
  const reply: CranePage = { items: rest, total: all.length, next_cursor: null };
  if (limit > 0) {
    reply.items = rest.slice(0, limit);
    reply.next_cursor = rest.length > limit ? (reply.items.at(-1)?.id ?? null) : null;
  }
  res.json(reply);
});

// Manufacturers and types in use, for autocomplete and the merge tool.
cranesRouter.get('/facets', (_req, res) => {
  res.json(facets());
});

// Moves every crane under manufacturer `from` to `into` (a typo fix). A crane takes the
// slug for its new make; if that crane already exists, its files join it instead.
cranesRouter.post('/merge-make', writeLimit, async (req, res) => {
  const body = bodyOf(req);
  const from = text(body, 'from');
  const into = text(body, 'into');
  if (!from || !into) throw new HttpError(400, 'from and into are required');
  if (from === into) throw new HttpError(400, 'from and into are the same');
  capField(into, 'Manufacturer');

  const reply = await withLock(async () => {
    const sources = listCranes().filter((c) => c.make === from);
    if (sources.length === 0) throw new HttpError(404, `No cranes with manufacturer "${from}"`);
    const db = getDb();
    const now = isoNow();
    let moved = 0;
    let absorbed = 0;
    for (const crane of sources) {
      const newId = generateCraneId(into, crane.type, crane.model, crane.capacity);
      const oldDir = craneDir(crane.id);
      if (!getCrane(newId)) {
        await renameCrane(crane.id, newId, () => {
          db.prepare('UPDATE cranes SET id = ?, make = ?, updated_at = ? WHERE id = ?').run(
            newId,
            into,
            now,
            crane.id
          );
        });
        moved += 1;
      } else {
        const targetDir = craneDir(newId);
        await mkdir(targetDir, { recursive: true });
        const rows: Array<Omit<FileRow, 'id' | 'crane_id'>> = [];
        for (const f of crane.files) {
          const stored = dedupeStoredName(targetDir, f.stored_name);
          const src = join(oldDir, f.stored_name);
          if (existsSync(src)) await rename(src, join(targetDir, stored));
          rows.push({ ...f, stored_name: stored });
        }
        db.transaction(() => {
          const insert = db.prepare(
            `INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
             VALUES (?, ?, ?, ?, ?)`
          );
          for (const r of rows)
            insert.run(newId, r.stored_name, r.original_filename, r.label, r.uploaded_at);
          db.prepare('DELETE FROM files WHERE crane_id = ?').run(crane.id);
          db.prepare('DELETE FROM cranes WHERE id = ?').run(crane.id);
        })();
        await rm(oldDir, { recursive: true, force: true });
        absorbed += 1;
      }
      logEvent('merge', crane.id, { make: from }, { make: into, new_id: newId });
    }
    return { success: true, moved, absorbed } satisfies MergeReply;
  });
  res.json(reply);
});

/**
 * Renames a crane's folder and then its rows (`updateCrane` changes the cranes row; the
 * files rows follow here), in one transaction. If the database step fails, the folder is
 * renamed back, so the disk and the database never disagree.
 */
async function renameCrane(oldId: string, newId: string, updateCrane: () => void) {
  const oldDir = craneDir(oldId);
  const newDir = craneDir(newId);
  const movedDir = existsSync(oldDir);
  if (movedDir) await rename(oldDir, newDir);
  try {
    const db = getDb();
    db.transaction(() => {
      updateCrane();
      db.prepare('UPDATE files SET crane_id = ? WHERE crane_id = ?').run(newId, oldId);
    })();
  } catch (err) {
    if (movedDir && existsSync(newDir) && !existsSync(oldDir)) await rename(newDir, oldDir);
    throw err;
  }
}

// A new crane from its first (primary) PDF and its details. The bulk importer also sends
// `label` for that first file.
cranesRouter.post('/upload', uploadLimit, cleanUpUpload, receivePdf, async (req, res) => {
  const body = bodyOf(req);
  const field = (key: string) => (typeof body[key] === 'string' ? body[key] : 'Unknown');
  const make = field('make');
  const type = field('type');
  const model = field('model');
  const capacity = field('capacity');
  const label = text(body, 'label');
  const file = await checkedPdf(req.file);
  capField(make, 'Manufacturer');
  capField(type, 'Type');
  capField(model, 'Model');
  capField(capacity, 'Capacity');
  capField(label, 'Label');

  const crane = await withLock(async () => {
    const id = generateCraneId(make, type, model, capacity);
    if (getCrane(id)) throw new HttpError(409, 'File with these specifications already exists');
    const now = isoNow();
    const db = getDb();
    const stored = await placeFile(id, file);
    db.transaction(() => {
      db.prepare(
        `INSERT INTO cranes (id, make, type, model, capacity, uploaded_at, updated_at, primary_file)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
      ).run(id, make, type, model, capacity, now);
      const fileId = insertFile(id, stored, file.originalname, label, now);
      db.prepare('UPDATE cranes SET primary_file = ? WHERE id = ?').run(fileId, id);
    })();
    const created = mustGetCrane(id);
    logEvent('upload', id, null, auditSnapshot(created));
    return created;
  });
  res.status(201).json({ success: true, ...crane } satisfies CraneReply);
});

// Another PDF for an existing crane, with an optional label.
cranesRouter.post('/cranes/:id/files', writeLimit, cleanUpUpload, receivePdf, async (req, res) => {
  const { id } = req.params as { id: string };
  const label = text(bodyOf(req), 'label');
  const file = await checkedPdf(req.file);
  capField(label, 'Label');
  const crane = await withLock(async () => {
    mustGetCrane(id);
    const stored = await placeFile(id, file);
    insertFile(id, stored, file.originalname, label, isoNow());
    logEvent('file_add', id, null, { stored_name: stored, label });
    return mustGetCrane(id);
  });
  res.status(201).json({ success: true, ...crane } satisfies CraneReply);
});

/** file_id as Python's int() read it: a whole number, or a string of digits. */
function fileIdFrom(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) return Number(value.trim());
  throw new HttpError(400, 'file_id is required');
}

// Which file opens by default.
cranesRouter.put('/cranes/:id/primary', writeLimit, async (req, res) => {
  const { id } = req.params as { id: string };
  const fileId = fileIdFrom(bodyOf(req).file_id);
  const crane = await withLock(() => {
    const before = mustGetCrane(id);
    if (!before.files.some((f) => f.id === fileId))
      throw new HttpError(404, 'File not found on this crane');
    getDb().prepare('UPDATE cranes SET primary_file = ? WHERE id = ?').run(fileId, id);
    logEvent(
      'primary_change',
      id,
      { primary_file_id: before.primary_file_id },
      { primary_file_id: fileId }
    );
    return mustGetCrane(id);
  });
  res.json({ success: true, ...crane } satisfies CraneReply);
});

// Renames a file's label (the name on its chip in the viewer).
cranesRouter.patch('/cranes/:id/files/:fileId', writeLimit, async (req, res) => {
  const { id, fileId: raw } = req.params as { id: string; fileId: string };
  const fileId = fileIdParam(raw);
  const label = capField(text(bodyOf(req), 'label'), 'Label');
  const crane = await withLock(() => {
    const target = mustGetCrane(id).files.find((f) => f.id === fileId);
    if (!target) throw new HttpError(404, 'File not found on this crane');
    getDb()
      .prepare('UPDATE files SET label = ? WHERE id = ? AND crane_id = ?')
      .run(label, fileId, id);
    logEvent('label_edit', id, { label: target.label }, { label });
    return mustGetCrane(id);
  });
  res.json({ success: true, ...crane } satisfies CraneReply);
});

// Deletes one file. The last file takes the crane with it; deleting the primary makes the
// earliest remaining file the primary.
cranesRouter.delete('/cranes/:id/files/:fileId', writeLimit, async (req, res) => {
  const { id, fileId: raw } = req.params as { id: string; fileId: string };
  const fileId = fileIdParam(raw);
  const reply = await withLock(async (): Promise<DeleteFileReply> => {
    const crane = mustGetCrane(id);
    const target = crane.files.find((f) => f.id === fileId);
    if (!target) throw new HttpError(404, 'File not found on this crane');
    await rm(join(craneDir(id), target.stored_name), { force: true });
    const wasLast = crane.files.length === 1;
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
      if (wasLast) db.prepare('DELETE FROM cranes WHERE id = ?').run(id);
      else if (crane.primary_file_id === fileId)
        db.prepare('UPDATE cranes SET primary_file = NULL WHERE id = ?').run(id);
    })();
    if (wasLast) {
      await rm(craneDir(id), { recursive: true, force: true });
      logEvent('delete', id, auditSnapshot(crane), null);
      return { success: true, crane_deleted: true };
    }
    logEvent('file_remove', id, { stored_name: target.stored_name }, null);
    return { success: true, crane_deleted: false, ...mustGetCrane(id) };
  });
  res.json(reply);
});

// Edits a crane's details. When the slug changes, its folder is renamed (one rename for
// all its files) together with its rows.
cranesRouter.put('/metadata/:id', writeLimit, async (req, res) => {
  const { id } = req.params as { id: string };
  const body = bodyOf(req);
  const make = text(body, 'make');
  const type = text(body, 'type');
  const model = text(body, 'model');
  const capacity = text(body, 'capacity');
  if (!make || !type || !model || !capacity)
    throw new HttpError(400, 'make, type, model, and capacity are required');
  capField(make, 'Manufacturer');
  capField(type, 'Type');
  capField(model, 'Model');
  capField(capacity, 'Capacity');

  const reply = await withLock(async (): Promise<MetadataReply> => {
    const crane = mustGetCrane(id, 'File not found');
    const newId = generateCraneId(make, type, model, capacity);
    const now = isoNow();
    const before = auditSnapshot(crane);
    const db = getDb();
    if (newId === id) {
      db.prepare(
        'UPDATE cranes SET make = ?, type = ?, model = ?, capacity = ?, updated_at = ? WHERE id = ?'
      ).run(make, type, model, capacity, now, id);
      const updated = mustGetCrane(id);
      logEvent('edit', id, before, auditSnapshot(updated));
      return { success: true, renamed: false, old_name: id, ...updated };
    }
    if (getCrane(newId))
      throw new HttpError(409, 'A specification with these details already exists');
    await renameCrane(id, newId, () => {
      db.prepare(
        `UPDATE cranes SET id = ?, make = ?, type = ?, model = ?, capacity = ?, updated_at = ?
         WHERE id = ?`
      ).run(newId, make, type, model, capacity, now, id);
    });
    const updated = mustGetCrane(newId);
    logEvent('edit', id, before, { ...auditSnapshot(updated), new_id: newId });
    return { success: true, renamed: true, old_name: id, ...updated };
  });
  res.json(reply);
});

// Deletes a whole crane: its folder, its files and its row.
cranesRouter.delete('/delete/:id', writeLimit, async (req, res) => {
  const { id } = req.params as { id: string };
  await withLock(async () => {
    const crane = mustGetCrane(id, 'File not found');
    await rm(craneDir(id), { recursive: true, force: true });
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM files WHERE crane_id = ?').run(id);
      db.prepare('DELETE FROM cranes WHERE id = ?').run(id);
    })();
    logEvent('delete', id, auditSnapshot(crane), null);
  });
  res.json({ success: true });
});

// The whole catalogue (cranes and their files) as a JSON download.
cranesRouter.get('/export', (_req, res) => {
  const catalogue: CatalogueExport = Object.fromEntries(listCranes().map((c) => [c.id, c]));
  res
    .type('application/json')
    .attachment('crane_export.json')
    .send(JSON.stringify(catalogue, null, 2));
});
