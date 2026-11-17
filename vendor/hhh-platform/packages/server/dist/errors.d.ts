import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from './logger.ts';
export declare class HttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare const notFound: RequestHandler;
export declare function errorHandler(logger: Logger): ErrorRequestHandler;
