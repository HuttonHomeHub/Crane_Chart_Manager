// Every setting, read once at startup with the shared kit, to the container standard in
// ~/projects/CLAUDE.md: the shared names (LOG_LEVEL, TRUST_PROXY, DATA_DIR, DB_PATH,
// UPLOADS_DIR, APP_VERSION) plus Crane Charts' own. A bad value stops startup listing
// every problem. The old CRANE_-prefixed names still work (one warning each at startup).
import { loadSettings, parseRate, SettingsError, sharedSettings, type Rate } from '@hhh/server';
import { z } from 'zod';

const flag = z
  .enum(['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'])
  .default('1')
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v));

const rate = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((raw, ctx) => {
      try {
        return parseRate(raw);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
        return z.NEVER;
      }
    });

const shape = {
  ...sharedSettings,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  // Largest PDF accepted, and longest make/type/model/capacity value.
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  MAX_FIELD_LEN: z.coerce.number().int().positive().default(64),
  // Per-IP limits on uploads and on every other change.
  UPLOAD_RATE: rate('60 per minute'),
  WRITE_RATE: rate('60 per minute'),
  // Backups: a zip of the database (and uploads) every BACKUP_INTERVAL_HOURS into
  // BACKUP_DIR (default: backups/ beside the database), keeping BACKUP_KEEP of each kind.
  BACKUP_DIR: z.string().min(1).optional(),
  BACKUP_ENABLED: flag,
  BACKUP_INTERVAL_HOURS: z.coerce.number().positive().default(24),
  BACKUP_KEEP: z.coerce.number().int().positive().default(7),
  BACKUP_INCLUDE_UPLOADS: flag,
  MAX_RESTORE_MB: z.coerce.number().int().positive().default(4096),
};

type Name = keyof typeof shape;

// Old names: CRANE_ + the new name, except these three.
const RENAMED: Partial<Record<Name, string>> = {
  DB_PATH: 'CRANE_DB',
  UPLOADS_DIR: 'CRANE_UPLOAD_DIR',
  APP_VERSION: 'CRANE_VERSION',
};
const legacy = Object.fromEntries(
  (Object.keys(shape) as Name[])
    .filter((name) => name !== 'NODE_ENV')
    .map((name) => [name, RENAMED[name] ?? `CRANE_${name}`])
) as Partial<Record<Name, string>>;

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  isTest: boolean;
  port: number;
  logLevel: z.infer<typeof sharedSettings.LOG_LEVEL>;
  trustProxyHops: number;
  appVersion: string;
  maxUploadBytes: number;
  maxFieldLen: number;
  uploadRate: Rate;
  writeRate: Rate;
  backup: {
    dir: string | undefined;
    enabled: boolean;
    intervalHours: number;
    keep: number;
    includeUploads: boolean;
    maxRestoreBytes: number;
  };
  dataDir: string | undefined;
  dbPath: string | undefined;
  uploadsDir: string | undefined;
}

const MB = 1024 * 1024;

/** Reads the settings from `env`; throws SettingsError listing every bad value. */
export function readConfig(env: Record<string, string | undefined>): {
  config: Config;
  deprecated: Array<[string, string]>;
} {
  const { settings: s, deprecated } = loadSettings(shape, { env, legacy });
  return {
    config: {
      nodeEnv: s.NODE_ENV,
      isTest: s.NODE_ENV === 'test',
      port: s.PORT,
      logLevel: s.NODE_ENV === 'test' ? 'silent' : s.LOG_LEVEL,
      trustProxyHops: s.TRUST_PROXY,
      appVersion: s.APP_VERSION,
      maxUploadBytes: s.MAX_UPLOAD_MB * MB,
      maxFieldLen: s.MAX_FIELD_LEN,
      uploadRate: s.UPLOAD_RATE,
      writeRate: s.WRITE_RATE,
      backup: {
        dir: s.BACKUP_DIR,
        enabled: s.BACKUP_ENABLED,
        intervalHours: s.BACKUP_INTERVAL_HOURS,
        keep: s.BACKUP_KEEP,
        includeUploads: s.BACKUP_INCLUDE_UPLOADS,
        maxRestoreBytes: s.MAX_RESTORE_MB * MB,
      },
      dataDir: s.DATA_DIR,
      dbPath: s.DB_PATH,
      uploadsDir: s.UPLOADS_DIR,
    },
    deprecated,
  };
}

export { SettingsError };

const loaded = readConfig(process.env);

export const config = loaded.config;

/** Old setting names still in use, as [old, new] pairs; index.ts logs a warning for each. */
export const deprecatedSettings = loaded.deprecated;
