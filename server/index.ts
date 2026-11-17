import { gracefulShutdown } from '@hhh/server';
import { app } from './app.ts';
import { config, deprecatedSettings } from './config.ts';
import { logger } from './logger.ts';
import { closeDb, openDb } from './db.ts';
import { renameLegacyBackups, startBackups } from './services/backups.ts';

for (const [oldName, newName] of deprecatedSettings) {
  logger.warn(`setting ${oldName} is deprecated; use ${newName}`);
}

// Don't bind a port under test — supertest drives the app object directly.
if (!config.isTest) {
  openDb();
  await renameLegacyBackups();
  const server = app.listen(config.port, () => {
    logger.info(`Crane Charts listening on http://localhost:${config.port}`);
  });
  // Scheduled backups (BACKUP_INTERVAL_HOURS); the first runs five minutes after start.
  const stopBackups = startBackups();
  gracefulShutdown(server, {
    logger,
    onClose: () => {
      stopBackups();
      closeDb();
    },
  });
}

export { app };
