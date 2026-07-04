import { Queue } from './fake-bullmq.js';
import { redisConnection } from './connection.js';
import { CompressionJobData, ConversionJobData, BatchImageConversionJobData, TorrentConversionJobData } from '../models/types.js';

export const CONVERSION_QUEUE_NAME = 'conversion-jobs';
export const COMPRESSION_QUEUE_NAME = 'compression-jobs';
export const TORRENT_QUEUE_NAME = 'torrent-jobs';

export const conversionQueue = new Queue<ConversionJobData>(CONVERSION_QUEUE_NAME, {
    connection: redisConnection,
});

export const compressionQueue = new Queue<CompressionJobData | BatchImageConversionJobData>(COMPRESSION_QUEUE_NAME, {
    connection: redisConnection,
});

export const torrentQueue = new Queue<TorrentConversionJobData>(TORRENT_QUEUE_NAME, {
    connection: redisConnection,
});
