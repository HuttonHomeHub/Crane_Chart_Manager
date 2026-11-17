import express, { type Express } from 'express';
import { createBaseApp, finishApp } from '@hhh/server';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { pingDb } from './db.ts';
import { uploadsDir } from './paths.ts';
import { backupsRouter, infoRouter } from './routes/backups.ts';
import { cranesRouter } from './routes/cranes.ts';

export function createApp(): Express {
  // The shared kit's front half, the same in every app: proxy trust (TRUST_PROXY hops),
  // security headers with a strict CSP, compression, header-free request logs,
  // /health, /version and /ready (which pings the database), JSON bodies, and CSRF.
  const app = createBaseApp({
    logger,
    version: config.appVersion,
    trustProxyHops: config.trustProxyHops,
    ready: pingDb,
  });

  app.use('/api/backup', backupsRouter);
  app.use('/api/info', infoRouter);
  app.use('/api', cranesRouter);

  // The PDFs, at /uploads/<crane id>/<stored name>. Range requests work, so the viewer
  // can fetch a large chart a page at a time.
  app.use('/uploads', express.static(uploadsDir, { index: false, dotfiles: 'deny' }));
  app.use('/uploads', (_req, res) => {
    res.status(404).json({ error: 'File not found' });
  });

  // The React front end arrives in phase 4.3 (the 1.x page is still what ships).

  finishApp(app, logger);
  return app;
}

export const app = createApp();
