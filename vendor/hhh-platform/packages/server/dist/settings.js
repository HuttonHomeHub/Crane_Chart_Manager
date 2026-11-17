// Settings from environment variables, to the shared container standard: unprefixed
// names, the same in every app for the same idea. A renamed setting keeps working
// under its old name, collected in `deprecated` for one startup warning each; the new
// name always wins. A bad value stops startup with every problem listed.
import { z } from 'zod';
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
/** TRUST_PROXY as a hop count: 0, unset or false = off; true = 1; N = N hops. */
export function parseTrustProxy(raw) {
    const value = raw.trim().toLowerCase();
    if (['', '0', 'false', 'no', 'off'].includes(value))
        return 0;
    if (['true', 'yes', 'on'].includes(value))
        return 1;
    if (/^\d+$/.test(value))
        return Number(value);
    throw new Error(`must be a hop count (0, 1, 2 ...), got "${raw}"`);
}
/** Settings every app has, with the standard's names. */
export const sharedSettings = {
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    TRUST_PROXY: z
        .string()
        .default('0')
        .transform((raw, ctx) => {
        try {
            return parseTrustProxy(raw);
        }
        catch (err) {
            ctx.addIssue({ code: 'custom', message: err.message });
            return z.NEVER;
        }
    }),
    DATA_DIR: z.string().min(1).optional(),
    DB_PATH: z.string().min(1).optional(),
    UPLOADS_DIR: z.string().min(1).optional(),
    APP_VERSION: z.string().min(1).default('dev'),
};
export class SettingsError extends Error {
    problems;
    constructor(problems) {
        super(`Invalid settings:\n${problems.map((p) => `  ${p}`).join('\n')}`);
        this.name = 'SettingsError';
        this.problems = problems;
    }
}
/**
 * Reads `shape` (the shared settings merged with the app's own) from `env`.
 * `legacy` maps a setting to its old name, e.g. { DB_PATH: 'PHOTOS_DB_PATH' }.
 */
export function loadSettings(shape, options = {}) {
    const env = options.env ?? process.env;
    const legacy = options.legacy ?? {};
    const input = {};
    const deprecated = [];
    for (const name of Object.keys(shape)) {
        const value = env[name];
        const oldName = legacy[name];
        if (value !== undefined && value !== '')
            input[name] = value;
        else if (oldName && env[oldName] !== undefined && env[oldName] !== '') {
            input[name] = env[oldName];
            deprecated.push([oldName, name]);
        }
    }
    const parsed = z.object(shape).safeParse(input);
    if (!parsed.success) {
        throw new SettingsError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(settings)'}: ${issue.message}`));
    }
    return { settings: parsed.data, deprecated };
}
/** DB_PATH and UPLOADS_DIR default inside DATA_DIR; without DATA_DIR, inside `fallbackDir`. */
export function resolveDataPaths(settings, options) {
    const dataDir = settings.DATA_DIR ?? options.fallbackDir;
    return {
        dataDir,
        dbPath: settings.DB_PATH ?? options.join(dataDir, options.dbFile),
        uploadsDir: settings.UPLOADS_DIR ?? options.join(dataDir, 'uploads'),
    };
}
