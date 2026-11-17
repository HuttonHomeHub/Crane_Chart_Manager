import { rateLimit } from 'express-rate-limit';
const UNITS = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
};
export function parseRate(text) {
    const m = /^\s*(\d+)\s*(?:per|\/)\s*(?:(\d+)\s*)?(second|minute|hour|day)s?\s*$/i.exec(text);
    const limit = Number(m?.[1]);
    const count = m?.[2] === undefined ? 1 : Number(m[2]);
    if (!m || limit < 1 || count < 1)
        throw new Error(`rate must look like "60 per minute" or "1000 per 15 minutes", got "${text}"`);
    return { limit, windowMs: count * (UNITS[(m[3] ?? '').toLowerCase()] ?? 0) };
}
export function rateLimiter(rate) {
    return rateLimit({
        limit: rate.limit,
        windowMs: rate.windowMs,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, res) => {
            res.status(429).json({ error: 'Too many requests; wait a moment and try again' });
        },
    });
}
