import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Shared Redis connection used by BullMQ queues/workers and directly for
 * rate limiting, profile-picture cache, and OTP rate limiting.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ — without it the
 * connection is closed whenever a blocking command is used.
 */
export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    // Do not buffer commands while disconnected: with the offline queue enabled,
    // a down Redis makes every request-path command (rate-limit incr, health
    // ping, OTP lookups) hang forever, defeating the fail-open design. Fail
    // fast instead so routes return quickly and the health endpoint reports
    // the outage.
    enableOfflineQueue: false,
    connectTimeout: 5000,
    // Keep retrying forever (bounded backoff) so a transient Redis outage does
    // not permanently kill the queue/worker for the lifetime of the process.
    // Returning null here made ioredis give up forever after 30 failed retries,
    // leaving orphaned jobs and dead workers until restart.
    retryStrategy(times) {
        if (times <= 3) {
            return Math.min(times * 500, 1000);
        }
        return 5000;
    },
});

redis.on('connect', () => logger.info('Redis connection established'));
redis.on('ready', () => logger.info('Redis ready'));
redis.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
});

/**
 * Resolves the first time the connection reports `ready`.
 *
 * Serverless adapters (api/backend.ts) await this before serving traffic:
 * with `enableOfflineQueue: false` a cold start that races the TCP handshake
 * would otherwise fail every request-path Redis command. The promise never
 * rejects (ioredis keeps retrying), so awaiting code should apply its own
 * timeout.
 */
let resolveRedisReady!: () => void;
export const redisReady = new Promise<void>((resolve) => {
    resolveRedisReady = resolve;
});
// Nobody may be awaiting this promise (e.g. worker-only processes) — a
// silent catch keeps an unconsumed rejection from being logged.
redisReady.catch(() => {});
if (redis.status === 'ready') {
    resolveRedisReady();
} else {
    redis.once('ready', () => resolveRedisReady());
}

// BullMQ needs a plain object with status accessors. ioredis instances
// already expose `status`, which satisfies BullMQ's ConnectionOptions.
export const redisConnection = redis;

/**
 * Fail-open Redis helpers for non-critical request-path state (profile cache,
 * cache invalidation, soft rate limits).
 *
 * `enableOfflineQueue: false` turns a Redis outage into an immediate
 * rejection. That is correct for hard dependencies, but these callers are
 * caches and best-effort limits: a blip must not 500 an otherwise-healthy
 * request. Every helper logs and returns a benign fallback value.
 */
export async function safeRedisGet(key: string): Promise<string | null> {
    try {
        return await redis.get(key);
    } catch (err) {
        logger.warn({ key, err }, 'Redis GET failed (fail-open)');
        return null;
    }
}

export async function safeRedisDel(key: string): Promise<void> {
    try {
        await redis.del(key);
    } catch (err) {
        logger.warn({ key, err }, 'Redis DEL failed (fail-open)');
    }
}

export async function safeRedisSetex(key: string, ttlSeconds: number, value: string): Promise<void> {
    try {
        await redis.setex(key, ttlSeconds, value);
    } catch (err) {
        logger.warn({ key, err }, 'Redis SETEX failed (fail-open)');
    }
}

export async function safeRedisIncr(key: string): Promise<number | null> {
    try {
        return await redis.incr(key);
    } catch (err) {
        logger.warn({ key, err }, 'Redis INCR failed (fail-open)');
        return null;
    }
}

export async function safeRedisExpire(key: string, ttlSeconds: number): Promise<void> {
    try {
        await redis.expire(key, ttlSeconds);
    } catch (err) {
        logger.warn({ key, err }, 'Redis EXPIRE failed (fail-open)');
    }
}
