// CSRF protection by double-submit cookie: the server sets a random token in the
// hhh_csrf cookie (readable by the page, SameSite=Strict), and every
// POST/PUT/PATCH/DELETE must send the same token in the X-CSRF-Token header. Another
// site can make the browser send the cookie but cannot read it to copy into the header.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from "./errors.js";
export const CSRF_COOKIE = 'hhh_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export function readCookie(req, name) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0 && part.slice(0, eq).trim() === name)
            return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return undefined;
}
function issue(req, res) {
    const token = randomBytes(32).toString('hex');
    const secure = req.secure ? '; Secure' : '';
    res.append('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict${secure}`);
}
function same(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}
export const csrf = (req, res, next) => {
    const cookie = readCookie(req, CSRF_COOKIE);
    if (!cookie)
        issue(req, res);
    if (SAFE_METHODS.has(req.method)) {
        next();
        return;
    }
    const header = req.get(CSRF_HEADER);
    if (!cookie || !header || !same(cookie, header)) {
        next(new HttpError(403, 'Missing or invalid CSRF token; reload the page and try again'));
        return;
    }
    next();
};
