import { ZodError } from 'zod';
export class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}
export const notFound = (_req, _res, next) => next(new HttpError(404, 'Not found'));
/** A 4xx status the error carries itself, or undefined. */
function clientStatus(err) {
    const status = err.status ?? err.statusCode;
    return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}
export function errorHandler(logger) {
    return (err, req, res, next) => {
        if (res.headersSent) {
            next(err);
            return;
        }
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        if (err instanceof ZodError) {
            res.status(400).json({
                error: 'Invalid request',
                details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            });
            return;
        }
        const libError = (err ?? {});
        if (libError.type === 'entity.too.large') {
            res.status(413).json({ error: 'Request is too large' });
            return;
        }
        if (libError.type === 'entity.parse.failed') {
            res.status(400).json({ error: 'Request body is not valid JSON' });
            return;
        }
        // multer, for uploads: the file is over the route's `limits.fileSize`.
        if (libError.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: 'File is too large' });
            return;
        }
        const status = clientStatus(libError);
        if (status !== undefined) {
            res.status(status).json({ error: libError.message || 'Bad request' });
            return;
        }
        (req.log ?? logger).error({ err }, 'Unhandled error');
        res.status(500).json({ error: 'Internal server error' });
    };
}
