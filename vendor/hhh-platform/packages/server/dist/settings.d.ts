import { z } from 'zod';
export declare const LOG_LEVELS: readonly ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
export type LogLevel = (typeof LOG_LEVELS)[number];
/** TRUST_PROXY as a hop count: 0, unset or false = off; true = 1; N = N hops. */
export declare function parseTrustProxy(raw: string): number;
/** Settings every app has, with the standard's names. */
export declare const sharedSettings: {
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        fatal: "fatal";
        error: "error";
        warn: "warn";
        info: "info";
        debug: "debug";
        trace: "trace";
        silent: "silent";
    }>>;
    TRUST_PROXY: z.ZodPipe<z.ZodDefault<z.ZodString>, z.ZodTransform<number, string>>;
    DATA_DIR: z.ZodOptional<z.ZodString>;
    DB_PATH: z.ZodOptional<z.ZodString>;
    UPLOADS_DIR: z.ZodOptional<z.ZodString>;
    APP_VERSION: z.ZodDefault<z.ZodString>;
};
export declare class SettingsError extends Error {
    readonly problems: string[];
    constructor(problems: string[]);
}
export interface LoadedSettings<T> {
    settings: T;
    /** [old name, new name] for every old name that supplied a value. */
    deprecated: Array<[string, string]>;
}
/**
 * Reads `shape` (the shared settings merged with the app's own) from `env`.
 * `legacy` maps a setting to its old name, e.g. { DB_PATH: 'PHOTOS_DB_PATH' }.
 */
export declare function loadSettings<S extends z.ZodRawShape>(shape: S, options?: {
    env?: Record<string, string | undefined>;
    legacy?: Partial<Record<keyof S & string, string>>;
}): LoadedSettings<z.infer<z.ZodObject<S>>>;
export interface DataPaths {
    dataDir: string;
    dbPath: string;
    uploadsDir: string;
}
/** DB_PATH and UPLOADS_DIR default inside DATA_DIR; without DATA_DIR, inside `fallbackDir`. */
export declare function resolveDataPaths(settings: {
    DATA_DIR?: string | undefined;
    DB_PATH?: string | undefined;
    UPLOADS_DIR?: string | undefined;
}, options: {
    dbFile: string;
    fallbackDir: string;
    join: (...parts: string[]) => string;
}): DataPaths;
