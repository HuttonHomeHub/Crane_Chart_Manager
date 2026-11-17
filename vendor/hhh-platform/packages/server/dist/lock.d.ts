export type WithLock = <T>(work: () => T | Promise<T>) => Promise<T>;
export declare function createLock(): WithLock;
