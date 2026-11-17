// The common front and back of every app's Express server, so the order of
// middleware is the same everywhere:
//   const app = createBaseApp({ ... });      // proxy, security, logging, JSON, health, CSRF
//   app.use('/api/cranes', cranesRouter);     // the app's own routes
//   finishApp(app, logger);                   // JSON 404 for /api, the error handler
import compression from 'compression';
import express, {} from 'express';
import { csrf } from "./csrf.js";
import { errorHandler, notFound } from "./errors.js";
import { healthRoutes } from "./health.js";
import { httpLogger } from "./logger.js";
import { cspNonce, securityHeaders } from "./security.js";
export function createBaseApp(options) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', options.trustProxyHops > 0 ? options.trustProxyHops : false);
    app.use(cspNonce, securityHeaders(options.csp));
    app.use(compression());
    app.use(httpLogger(options.logger));
    app.use(healthRoutes({ version: options.version, ...(options.ready ? { ready: options.ready } : {}) }));
    app.use(express.json({ limit: options.jsonLimit ?? '1mb' }));
    app.use(csrf);
    return app;
}
export function finishApp(app, logger) {
    app.use('/api', notFound);
    app.use(errorHandler(logger));
}
