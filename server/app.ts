import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';
import { createBaseApp, finishApp } from '@hhh/server';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { pingDb } from './db.ts';
import { distDir, uploadsDir } from './paths.ts';
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

  // The React front end, when built: its files, and index.html for any other page
  // address (the app reads deep links from the hash). /api stays JSON.
  if (existsSync(join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false }));
    app.get('/{*path}', (req, res, next) => {
      if (req.path.startsWith('/api/')) next();
      else res.sendFile(join(distDir, 'index.html'));
    });
  }

  finishApp(app, logger);
  return app;
}

export const app = createApp();
