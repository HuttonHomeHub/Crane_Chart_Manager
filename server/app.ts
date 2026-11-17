import type { Express } from 'express';
import { createBaseApp, finishApp } from '@hhh/server';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { pingDb } from './db.ts';

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

  // Crane Charts' API arrives route by route in phase 4 (API parity).

  finishApp(app, logger);
  return app;
}

export const app = createApp();
