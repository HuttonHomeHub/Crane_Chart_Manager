// JSON-line logging with pino. One line per request with method, path, status,
// duration and a request id, and nothing else from the request (no headers or
// cookies), so logs stay small and free of session tokens.
import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
export function createLogger(options) {
    return pino({ name: options.name, level: options.level });
}
export function requestId() {
    return randomBytes(8).toString('hex');
}
export function httpLogger(logger) {
    return pinoHttp({
        logger,
        genReqId: (req, res) => {
            const id = requestId();
            res.setHeader('X-Request-Id', id);
            return id;
        },
        serializers: {
            req: (req) => ({
                id: req.id,
                method: req.method,
                url: req.url,
            }),
            res: (res) => ({ statusCode: res.statusCode }),
        },
        customLogLevel: (_req, res, err) => err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        // Health probes every 30 s would drown everything else.
        autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    });
}
