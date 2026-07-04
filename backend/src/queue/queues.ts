import { Queue } from './fake-bullmq.js';
import { redisConnection } from './connection.js';
import { CompressionJobData, ConversionJobData, BatchImageConversionJobData, UploadConversionJobData } from '../models/types.js';

export const CONVERSION_QUEUE_NAME = 'conversion-jobs';
export const COMPRESSION_QUEUE_NAME = 'compression-jobs';
export const UPLOAD_QUEUE_NAME = 'upload-jobs';

export const conversionQueue = new Queue<ConversionJobData>(CONVERSION_QUEUE_NAME, {
    connection: redisConnection,
});

export const compressionQueue = new Queue<CompressionJobData | BatchImageConversionJobData>(COMPRESSION_QUEUE_NAME, {
    connection: redisConnection,
});

export const uploadQueue = new Queue<UploadConversionJobData>(UPLOAD_QUEUE_NAME, {
    connection: redisConnection,
});
