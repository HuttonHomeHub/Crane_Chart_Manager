export function createLock() {
    let tail = Promise.resolve();
    return (work) => {
        const run = tail.then(work);
        tail = run.catch(() => undefined); // a failed write doesn't block the next one
        return run;
    };
}
