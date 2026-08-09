import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';
import { CompressionJobData, ConversionJobData, BatchImageConversionJobData } from '../models/types.js';

export const CONVERSION_QUEUE_NAME = 'conversion-jobs';
export const COMPRESSION_QUEUE_NAME = 'compression-jobs';

export const conversionQueue = new Queue<ConversionJobData>(CONVERSION_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 2000,
    },
});

export const compressionQueue = new Queue<CompressionJobData | BatchImageConversionJobData>(COMPRESSION_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 2000,
    },
});
