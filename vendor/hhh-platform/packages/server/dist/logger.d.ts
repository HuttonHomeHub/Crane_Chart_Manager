import { type Logger } from 'pino';
import { type HttpLogger } from 'pino-http';
import type { LogLevel } from './settings.ts';
export type { Logger } from 'pino';
export declare function createLogger(options: {
    level: LogLevel;
    name: string;
}): Logger;
export declare function requestId(): string;
export declare function httpLogger(logger: Logger): HttpLogger;
