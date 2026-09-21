import { env } from '../config/env.js';

class Semaphore {
    private permits: number;
    private readonly queue: Array<() => void> = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        this.permits++;
        if (this.queue.length > 0 && this.permits > 0) {
            this.permits--;
            const next = this.queue.shift();
            if (next) next();
        }
    }
}

const heavySemaphore = env.HEAVY_JOB_CONCURRENCY
    ? new Semaphore(env.HEAVY_JOB_CONCURRENCY)
    : null;

/**
 * Executes a function within the bounds of HEAVY_JOB_CONCURRENCY.
 * If HEAVY_JOB_CONCURRENCY is undefined or not set, executes immediately without locking.
 */
export async function withHeavyJobLock<T>(fn: () => Promise<T>): Promise<T> {
    if (!heavySemaphore) {
        return fn();
    }
    await heavySemaphore.acquire();
    try {
        return await fn();
    } finally {
        heavySemaphore.release();
    }
}
