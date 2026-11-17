import { describe, expect, it } from 'vitest';
import { readConfig } from '../server/config.ts';

describe('settings', () => {
  it('has the documented defaults', () => {
    const { config, deprecated } = readConfig({});
    expect(config.port).toBe(5000);
    expect(config.maxUploadBytes).toBe(500 * 1024 * 1024);
    expect(config.maxFieldLen).toBe(64);
    expect(config.uploadRate).toEqual({ limit: 60, windowMs: 60_000 });
    expect(config.writeRate).toEqual({ limit: 60, windowMs: 60_000 });
    expect(config.backup).toMatchObject({
      enabled: true,
      intervalHours: 24,
      keep: 7,
      includeUploads: true,
      maxRestoreBytes: 4096 * 1024 * 1024,
    });
    expect(config.trustProxyHops).toBe(0);
    expect(config.appVersion).toBe('dev');
    expect(deprecated).toEqual([]);
  });

  it('still reads the old CRANE_ names, reporting each as deprecated', () => {
    const { config, deprecated } = readConfig({
      CRANE_DB: '/data/old.db',
      CRANE_UPLOAD_DIR: '/data/pdfs',
      CRANE_VERSION: '1.9.0',
      CRANE_TRUST_PROXY: '1',
      CRANE_BACKUP_KEEP: '3',
    });
    expect(config.dbPath).toBe('/data/old.db');
    expect(config.uploadsDir).toBe('/data/pdfs');
    expect(config.appVersion).toBe('1.9.0');
    expect(config.trustProxyHops).toBe(1);
    expect(config.backup.keep).toBe(3);
    expect(deprecated).toEqual(
      expect.arrayContaining([
        ['CRANE_DB', 'DB_PATH'],
        ['CRANE_UPLOAD_DIR', 'UPLOADS_DIR'],
        ['CRANE_VERSION', 'APP_VERSION'],
        ['CRANE_TRUST_PROXY', 'TRUST_PROXY'],
        ['CRANE_BACKUP_KEEP', 'BACKUP_KEEP'],
      ])
    );
  });

  it('lets the new name win over the old one, without a warning', () => {
    const { config, deprecated } = readConfig({ DB_PATH: '/new.db', CRANE_DB: '/old.db' });
    expect(config.dbPath).toBe('/new.db');
    expect(deprecated).toEqual([]);
  });

  it('reads rates and switches in the shared forms', () => {
    const { config } = readConfig({
      UPLOAD_RATE: '10 per minute',
      WRITE_RATE: '100 per 15 minutes',
      BACKUP_ENABLED: '0',
      BACKUP_INCLUDE_UPLOADS: 'false',
    });
    expect(config.uploadRate).toEqual({ limit: 10, windowMs: 60_000 });
    expect(config.writeRate).toEqual({ limit: 100, windowMs: 900_000 });
    expect(config.backup.enabled).toBe(false);
    expect(config.backup.includeUploads).toBe(false);
  });

  it('stops startup on a bad value, naming the setting', () => {
    expect(() => readConfig({ TRUST_PROXY: 'lots' })).toThrow(/TRUST_PROXY/);
    expect(() => readConfig({ UPLOAD_RATE: 'fast' })).toThrow(/UPLOAD_RATE/);
    expect(() => readConfig({ MAX_UPLOAD_MB: '-1' })).toThrow(/MAX_UPLOAD_MB/);
    expect(() => readConfig({ BACKUP_ENABLED: 'maybe' })).toThrow(/BACKUP_ENABLED/);
  });
});
