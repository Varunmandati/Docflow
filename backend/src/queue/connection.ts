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

// BullMQ needs a plain object with status accessors. ioredis instances
// already expose `status`, which satisfies BullMQ's ConnectionOptions.
export const redisConnection = redis;
