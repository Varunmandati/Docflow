import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis } from '../queue/connection.js';

/**
 * Publish a liveness key into Redis with a TTL, refreshed on an interval.
 *
 * The TTL is what makes this a real signal rather than a "started once" flag: if
 * the worker event loop is wedged (a hung LibreOffice/FFmpeg child, an
 * unbounded output buffer, a synchronously blocking native call) the timer never
 * fires, the key expires, and GET /v1/health starts reporting `worker: stale`
 * even though the process is still alive and the Docker container still shows as
 * `running`. That is the only way a BullMQ worker can be observed, since a wedged
 * worker leaves no other trace on Redis.
 */
export function startWorkerHeartbeat(): NodeJS.Timeout {
    const beat = async () => {
        try {
            // TTL is several missed intervals of slack so one slow GC pause or a
            // momentary Redis hiccup does not flap the health status.
            await redis.set(
                env.WORKER_HEARTBEAT_KEY,
                String(Date.now()),
                'PX',
                env.WORKER_HEARTBEAT_STALE_MS * 3
            );
        } catch (err) {
            logger.error({ err }, 'Worker heartbeat failed - health will report the worker as stale');
        }
    };

    void beat();
    const timer = setInterval(() => void beat(), env.WORKER_HEARTBEAT_INTERVAL_MS);
    timer.unref();
    return timer;
}

/** Remove the heartbeat key so health reports the worker as gone while it drains. */
export async function clearWorkerHeartbeat(): Promise<void> {
    try {
        await redis.del(env.WORKER_HEARTBEAT_KEY);
    } catch {
        // Redis may already be gone during shutdown; nothing useful to do.
    }
}
