import fs from 'fs/promises';
import path from 'path';
import { logger } from '../config/logger.js';
import JSZip from 'jszip';

// Dynamic imports for ESM modules
let parseTorrent: any;
let torrentStream: any;

async function ensureModulesLoaded() {
    if (!parseTorrent) {
        parseTorrent = (await import('parse-torrent')).default;
    }
    if (!torrentStream) {
        torrentStream = (await import('torrent-stream')).default;
    }
}

export interface TorrentInfo {
    name: string;
    infoHash: string;
    files: Array<{
        name: string;
        length: number;
        path: string;
    }>;
    totalLength: number;
    announce: string[];
    created: string;
    comment?: string;
}

export interface TorrentFile {
    name: string;
    length: number;
    path: string;
}

export const PUBLIC_TRACKERS = [
  'udp://zer0day.ch:1337/announce',
  'udp://tracker.publictracker.xyz:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://udp.tracker.projectk.org:23333/announce',
  'udp://uabits.today:6990/announce',
  'udp://tracker.tryhackx.org:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://tracker.t-1.org:6969/announce',
  'udp://tracker.startwork.cv:1337/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.plx.im:6969/announce',
  'udp://tracker.opentorrent.top:6969/announce',
  'udp://tracker.nyaa.vc:6969/announce',
  'udp://tracker.iperson.xyz:6969/announce',
  'udp://tracker.gmi.gd:6969/announce',
  'udp://tracker.fnix.net:6969/announce',
  'udp://tracker.ducks.party:1984/announce',
  'udp://tracker.bluefrog.pw:2710/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.auctor.tv:6969/announce'
];

/**
 * Parse torrent file and extract metadata
 */
export async function parseTorrentFile(filePath: string): Promise<TorrentInfo> {
    try {
        const buffer = await fs.readFile(filePath);
        const parsed = await parseTorrent(buffer) as any;

        return {
            name: (parsed.name && typeof parsed.name === 'string' ? parsed.name : 'Unknown Torrent'),
            infoHash: parsed.infoHash ? String(parsed.infoHash) : '',
            files: (parsed.files && Array.isArray(parsed.files) ? parsed.files : []).map((file: any) => ({
                name: file.name || 'Unknown',
                length: file.length || 0,
                path: file.path || file.name || '',
            })),
            totalLength: parsed.length ? Number(parsed.length) : 0,
            announce: (parsed.announce && Array.isArray(parsed.announce) ? parsed.announce : []),
            created: new Date(parsed.created ? Number(parsed.created) : Date.now()).toISOString(),
            comment: parsed.comment ? String(parsed.comment) : undefined,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to parse torrent';
        logger.error({ err: error, filePath }, 'Error parsing torrent file');
        throw new Error(`Torrent parsing failed: ${message}`);
    }
}

/**
 * Stream torrent files and save to output directory
 */
export async function downloadTorrentContent(
    torrentPath: string,
    outputDir: string,
    fileFilter?: string[]
): Promise<Array<{ path: string; size: number }>> {
    await ensureModulesLoaded();
    
    return new Promise(async (resolve, reject) => {
        try {
            const downloadedFiles: Array<{ path: string; size: number }> = [];

            const engine = torrentStream(torrentPath, {
                connections: 500,
                uploads: 50,
                trackers: PUBLIC_TRACKERS,
                tmp: path.join(outputDir, '.torrent-tmp'),
            });

            engine.on('ready', async () => {
                try {
                    const files = engine.files;
                    const filesToDownload = fileFilter
                        ? files.filter((f: any) => fileFilter.includes(f.name))
                        : files;

                    if (filesToDownload.length === 0) {
                        engine.destroy();
                        return resolve([]);
                    }

                    // Start downloading all files concurrently to maximize bandwidth
                    filesToDownload.forEach((f: any) => f.select());

                    const downloadPromises = filesToDownload.map(async (file: any) => {
                        const filePath = path.join(outputDir, file.name);
                        const dirPath = path.dirname(filePath);
                        await fs.mkdir(dirPath, { recursive: true });

                        const stream = file.createReadStream();
                        const fd = await fs.open(filePath, 'w');
                        const writeStream = fd.createWriteStream();

                        stream.pipe(writeStream);

                        return new Promise<void>((resolveFile, rejectFile) => {
                            writeStream.on('finish', () => {
                                downloadedFiles.push({
                                    path: file.name,
                                    size: file.length,
                                });
                                logger.info(
                                    { fileName: file.name, size: file.length },
                                    'Torrent file downloaded'
                                );
                                resolveFile();
                            });
                            writeStream.on('error', rejectFile);
                            stream.on('error', rejectFile);
                        });
                    });

                    await Promise.all(downloadPromises);

                    engine.destroy();
                    clearTimeout(timeoutId);
                    resolve(downloadedFiles);
                } catch (error) {
                    engine.destroy();
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });

            engine.on('error', (error: Error) => {
                engine.destroy();
                clearTimeout(timeoutId);
                reject(error);
            });

            engine.on('timeout', () => {
                engine.destroy();
                clearTimeout(timeoutId);
                reject(new Error('Torrent download timeout'));
            });

            // Set timeout of 30 minutes
            const timeoutId = setTimeout(() => {
                engine.destroy();
                reject(new Error('Torrent download exceeded time limit'));
            }, 30 * 60 * 1000);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Create a ZIP archive from selected torrent files
 */
export async function createTorrentArchive(
    torrentPath: string,
    outputArchive: string,
    fileFilter?: string[]
): Promise<number> {
    try {
        await ensureModulesLoaded();
        
        const zip = new JSZip();

        const engine = torrentStream(torrentPath, {
            connections: 500,
            uploads: 50,
            trackers: PUBLIC_TRACKERS,
            tmp: path.dirname(outputArchive),
        });

        return new Promise((resolve, reject) => {
            engine.on('ready', async () => {
                try {
                    const files = engine.files;
                    const filesToArchive = fileFilter
                        ? files.filter((f: any) => fileFilter.includes(f.name))
                        : files.slice(0, 10); // Limit to first 10 files by default

                    // Start downloading all files concurrently
                    filesToArchive.forEach((f: any) => f.select());

                    for (const file of filesToArchive) {
                        const stream = file.createReadStream();
                        // Pass stream directly to JSZip instead of buffering in memory
                        zip.file(file.name, stream);
                    }

                    const archiveBuffer = await zip.generateAsync({
                        type: 'nodebuffer',
                        compression: 'DEFLATE',
                        compressionOptions: { level: 6 },
                    });

                    await fs.writeFile(outputArchive, archiveBuffer);
                    engine.destroy();

                    resolve(archiveBuffer.length);
                } catch (error) {
                    engine.destroy();
                    reject(error);
                }
            });

            engine.on('error', (error: Error) => {
                engine.destroy();
                reject(error);
            });
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Archive creation failed';
        logger.error({ err: error }, 'Error creating torrent archive');
        throw new Error(`Failed to create archive: ${message}`);
    }
}
