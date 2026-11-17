import type { Server } from 'node:http';
import type { Logger } from './logger.ts';
export interface ShutdownOptions {
    logger: Logger;
    onClose?: () => void | Promise<void>;
    timeoutMs?: number;
    signals?: NodeJS.Signals[];
    exit?: (code: number) => void;
}
/** Wires the signals and returns the shutdown function (also handy in tests). */
export declare function gracefulShutdown(server: Server, options: ShutdownOptions): (signal: string) => Promise<void>;
