import type { RequestHandler } from 'express';
export interface CspOptions {
    /** Extra image sources, e.g. map tile servers. */
    imgSrc?: string[];
    /** Extra fetch/XHR/WebSocket targets. */
    connectSrc?: string[];
}
export declare const cspNonce: RequestHandler;
export declare function securityHeaders(options?: CspOptions): RequestHandler;
