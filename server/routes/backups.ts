import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { HttpError, isBackupName, listBackups, RestoreError, rateLimiter } from '@hhh/server';
import type {
  BackupNowReply,
  BackupsReply,
  InstanceInfoReply,
  RestoreReply,
} from '../../shared/api.ts';
import { config } from '../config.ts';
import { countRows, logEvent } from '../cranes.ts';
import { backupDir, dbPath, uploadsDir } from '../paths.ts';
import {
  backupNow,
  backupSettings,
  backupTo,
  restoreFrom,
  schedulerStatus,
} from '../services/backups.ts';

// The same backup routes and replies as PhotoMapper, for the Settings panel's backups card.
export const backupsRouter = Router();
const writeLimit = rateLimiter(config.writeRate);

// What is configured, every backup in BACKUP_DIR (newest first) and how the schedule
// is doing, so a silently failing nightly backup shows up in the UI, not just the logs.
backupsRouter.get('/', async (_req, res) => {
  const backups = await listBackups(backupSettings);
  const reply: BackupsReply = {
    enabled: config.backup.enabled,
    dir: backupDir,
    intervalHours: config.backup.intervalHours,
    keep: config.backup.keep,
    includeUploads: config.backup.includeUploads,
    backups: backups.map((b) => ({
      name: b.name,
      size: b.size,
      createdAt: b.createdAt.toISOString(),
    })),
    scheduler: schedulerStatus(),
  };
  res.json(reply);
});

// Back up now (also lets a host cron drive backups when the schedule is off).
backupsRouter.post('/', writeLimit, async (_req, res) => {
  const path = await backupNow();
  const [entry] = (await listBackups(backupSettings)).filter((b) => b.name === basename(path));
  res.status(201).json({ name: basename(path), size: entry?.size ?? 0 } satisfies BackupNowReply);
});

// A freshly made backup, streamed as a download and not kept.
backupsRouter.get('/download', async (_req, res) => {
  const dir = await mkdtemp(join(tmpdir(), 'crane-download-'));
  try {
    const path = await backupTo(dir);
    await new Promise<void>((done, fail) =>
      res.download(path, basename(path), (err) => (err ? fail(err) : done()))
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// One of the backups listed above. Only names this app writes are accepted.
backupsRouter.get('/download/:name', (req, res) => {
  const { name } = req.params as { name: string };
  if (!isBackupName(backupSettings.prefix, name)) throw new HttpError(404, 'Backup not found');
  res.download(join(backupDir, name), name, { dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Backup not found' });
  });
});

// Uploaded zips wait in a temporary folder; the kit checks them before anything changes.
const restoreUpload = multer({
  dest: tmpdir(),
  limits: { fileSize: config.backup.maxRestoreBytes, files: 1 },
});

// Replace everything with a backup: JSON {name} for one in BACKUP_DIR, or a multipart
// `file` (a .zip, e.g. onto a fresh instance). A "prerestore" backup is taken first,
// so a restore can itself be undone.
backupsRouter.post('/restore', writeLimit, restoreUpload.single('file'), async (req, res) => {
  const uploaded = req.file;
  try {
    let zipPath: string;
    let source: string;
    if (uploaded) {
      if (!uploaded.originalname.toLowerCase().endsWith('.zip'))
        throw new HttpError(400, 'Backup must be a .zip archive');
      zipPath = uploaded.path;
      source = uploaded.originalname;
    } else {
      const name = (req.body as { name?: unknown } | undefined)?.name;
      if (typeof name !== 'string' || !name) throw new HttpError(400, 'No backup provided');
      if (!isBackupName(backupSettings.prefix, name))
        throw new HttpError(400, 'Invalid backup name');
      zipPath = join(backupDir, name);
      if (!existsSync(zipPath)) throw new HttpError(404, 'Backup not found');
      source = name;
    }
    const result = await restoreFrom(zipPath);
    const counts = countRows();
    // Recorded in the restored database, so it shows it was restored, and from what.
    logEvent('restore', '(restore)', null, { source, ...result, ...counts });
    res.json({ ...result, counts } satisfies RestoreReply);
  } catch (err) {
    if (err instanceof RestoreError) throw new HttpError(400, err.message);
    throw err;
  } finally {
    if (uploaded) await rm(uploaded.path, { force: true });
  }
});

// How this instance is set up, read-only, for the Settings panel.
export const infoRouter = Router();

infoRouter.get('/', (_req, res) => {
  const reply: InstanceInfoReply = {
    version: config.appVersion,
    counts: countRows(),
    paths: { database: dbPath, uploads: uploadsDir, backups: backupDir },
    limits: {
      maxUploadMb: Math.floor(config.maxUploadBytes / (1024 * 1024)),
      maxFieldLen: config.maxFieldLen,
      uploadRate: config.uploadRate,
      writeRate: config.writeRate,
    },
    trustProxyHops: config.trustProxyHops,
  };
  res.json(reply);
});
