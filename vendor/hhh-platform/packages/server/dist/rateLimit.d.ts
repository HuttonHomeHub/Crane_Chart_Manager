import type { RequestHandler } from 'express';
export interface Rate {
    limit: number;
    windowMs: number;
}
export declare function parseRate(text: string): Rate;
export declare function rateLimiter(rate: Rate): RequestHandler;
