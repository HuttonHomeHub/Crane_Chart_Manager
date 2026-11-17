import { Router } from 'express';
export declare function healthRoutes(options: {
    version: string;
    ready?: () => void | Promise<void>;
}): Router;
