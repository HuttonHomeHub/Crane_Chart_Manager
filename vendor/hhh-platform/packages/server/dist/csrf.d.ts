import type { Request, RequestHandler } from 'express';
export declare const CSRF_COOKIE = "hhh_csrf";
export declare const CSRF_HEADER = "x-csrf-token";
export declare function readCookie(req: Request, name: string): string | undefined;
export declare const csrf: RequestHandler;
