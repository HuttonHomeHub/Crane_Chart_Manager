/** Wires the signals and returns the shutdown function (also handy in tests). */
export function gracefulShutdown(server, options) {
    const { logger, onClose, timeoutMs = 10_000, signals = ['SIGTERM', 'SIGINT'], exit = process.exit, } = options;
    let started = false;
    const shutdown = async (signal) => {
        if (started)
            return;
        started = true;
        logger.info(`${signal} received, shutting down`);
        const force = setTimeout(() => {
            logger.error('Shutdown timed out, forcing exit');
            exit(1);
        }, timeoutMs);
        force.unref();
        try {
            await new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
            await onClose?.();
            clearTimeout(force);
            logger.info('Shutdown complete');
            exit(0);
        }
        catch (err) {
            clearTimeout(force);
            logger.error({ err }, 'Error during shutdown');
            exit(1);
        }
    };
    for (const signal of signals)
        process.once(signal, () => void shutdown(signal));
    return shutdown;
}
