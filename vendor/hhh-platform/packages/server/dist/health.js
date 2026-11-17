// The standard's probe routes. /health is liveness only (never touches the database),
// /ready also checks the database, /version reports what is running.
import { Router } from 'express';
export function healthRoutes(options) {
    const router = Router();
    router.get('/health', (_req, res) => {
        res.json({ status: 'ok', version: options.version });
    });
    router.get('/version', (_req, res) => {
        res.json({ version: options.version });
    });
    router.get('/ready', async (req, res) => {
        try {
            await options.ready?.();
            res.json({ status: 'ready' });
        }
        catch (err) {
            req.log?.error({ err }, 'Readiness check failed');
            res.status(503).json({ status: 'unavailable' });
        }
    });
    return router;
}
