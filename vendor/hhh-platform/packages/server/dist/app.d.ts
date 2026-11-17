import { type Express } from 'express';
import { type Logger } from './logger.ts';
import { type CspOptions } from './security.ts';
export interface BaseAppOptions {
    logger: Logger;
    version: string;
    /** Proxy hops in front (TRUST_PROXY); 0 = none. */
    trustProxyHops: number;
    ready?: () => void | Promise<void>;
    csp?: CspOptions;
    /** Largest JSON body accepted (uploads use their own limits). */
    jsonLimit?: string;
}
export declare function createBaseApp(options: BaseAppOptions): Express;
export declare function finishApp(app: Express, logger: Logger): void;
