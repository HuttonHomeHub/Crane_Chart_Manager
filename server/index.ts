import { gracefulShutdown } from '@hhh/server';
import { app } from './app.ts';
import { config, deprecatedSettings } from './config.ts';
import { logger } from './logger.ts';
import { closeDb, openDb } from './db.ts';

for (const [oldName, newName] of deprecatedSettings) {
  logger.warn(`setting ${oldName} is deprecated; use ${newName}`);
}

// Don't bind a port under test — supertest drives the app object directly.
if (!config.isTest) {
  openDb();
  const server = app.listen(config.port, () => {
    logger.info(`Crane Charts listening on http://localhost:${config.port}`);
  });
  gracefulShutdown(server, { logger, onClose: closeDb });
}

export { app };
