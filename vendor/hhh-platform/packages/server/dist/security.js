// Security headers (helmet) with a strict Content Security Policy: scripts only from
// this origin or carrying this request's nonce (res.locals.cspNonce), no eval, no
// plugins, no framing by other sites. Styles allow 'unsafe-inline' because libraries
// such as PDF.js and Leaflet set inline styles on elements they create.
import { randomBytes } from 'node:crypto';
import helmet from 'helmet';
export const cspNonce = (_req, res, next) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
};
export function securityHeaders(options = {}) {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                scriptSrc: [
                    "'self'",
                    // helmet passes Node's response; Express always hands it its own Response.
                    (_req, res) => `'nonce-${res.locals.cspNonce}'`,
                ],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'blob:', ...(options.imgSrc ?? [])],
                fontSrc: ["'self'"],
                connectSrc: ["'self'", ...(options.connectSrc ?? [])],
                workerSrc: ["'self'", 'blob:'],
                objectSrc: ["'none'"],
                frameSrc: ["'none'"],
                frameAncestors: ["'self'"],
                formAction: ["'self'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    });
}
