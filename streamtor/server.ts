import express from 'express';
import path from 'path';
import fs from 'fs';
import { promises as fsAsync } from 'fs';
import { createServer as createViteServer } from 'vite';
import WebTorrent from 'webtorrent';
import 'dotenv/config';

const client = new WebTorrent({
  // High connection limit to sustain 500+ Mbps from many peers.
  // Each peer connection = one TCP stream; more connections = more aggregate bandwidth.
  maxConns: 500,
  maxWebConns: 100,
  // uTP adds ~4x throughput penalty over TCP (its congestion control is
  // extremely conservative), measured ~0.3 MB/s vs ~1.2 MB/s on a well-seeded
  // torrent with identical peers. TCP is universally supported by seeders,
  // so disabling uTP gets real multi-MB/s downloads.
  utp: false,
  dht: {
    bootstrap: [
      'router.bittorrent.com:6881',
      'dht.transmissionbt.com:6881',
      'router.utorrent.com:6881',
      'router.bitcomet.com:6881',
      'dht.aelitis.com:6881',
      'dht.libtorrent.org:6881',
    ]
  },
  tracker: true,
  downloadLimit: -1,
  uploadLimit: -1,
  // Per-torrent max peers (default 55 in WebTorrent 3.x) - raise to match high maxConns
  maxPeers: 200,
  // Concurrency for piece verification — higher = faster progress updates
  // at the cost of slightly more CPU. Default is 4 in WebTorrent 3.x.
  numConcurrency: 16,
} as any);

client.on('error', (err: any) => {
  console.error('Global WebTorrent error:', err);
});

// ── Speed measurement (sliding-window) ────────────────────────────────────
// Keeps a ring buffer of {ts, downloaded, uploaded} samples per torrent.
// Speed = (bytes_now - bytes_oldest_in_window) / elapsed.
// This gives stable, accurate readings that directly reflect real throughput,
// unlike EMA which is inherently noisy on per-poll deltas.
const SPEED_WINDOW_MS = 10000; // 10-second sliding window
const SPEED_MIN_SAMPLES = 2;   // need at least 2 samples to compute rate
const speedSamples = new Map<string, Array<{ ts: number; downloaded: number; uploaded: number }>>();

function measureTorrentSpeed(infoHash: string, downloadedBytes: number, uploadedBytes: number) {
  const now = Date.now();
  let samples = speedSamples.get(infoHash);

  if (!samples) {
    samples = [];
    speedSamples.set(infoHash, samples);
  }

  // Append new sample
  samples.push({ ts: now, downloaded: downloadedBytes, uploaded: uploadedBytes });

  // Prune samples older than the window
  const cutoff = now - SPEED_WINDOW_MS;
  while (samples.length > 1 && samples[0].ts < cutoff) {
    samples.shift();
  }

  // Need at least 2 samples spanning >300ms to compute a rate
  if (samples.length < SPEED_MIN_SAMPLES) {
    return { down: 0, up: 0 };
  }

  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const elapsedSec = (newest.ts - oldest.ts) / 1000;

  if (elapsedSec < 0.3) {
    return { down: 0, up: 0 };
  }

  const deltaDown = Math.max(0, newest.downloaded - oldest.downloaded);
  const deltaUp = Math.max(0, newest.uploaded - oldest.uploaded);

  return {
    down: deltaDown / elapsedSec,
    up: deltaUp / elapsedSec
  };
}

function resetSpeedSmoothing(infoHash: string) {
  speedSamples.delete(infoHash);
}

// TTL cache for on-disk progress checks. Without this, every stats poll
// runs synchronous fs.statSync/fs.existsSync for every file of every torrent,
// which blocks the Node event loop that is also servicing the actual
// WebTorrent download traffic, throttling real download speeds.
const diskCheckCache = new Map<string, { expiresAt: number; exists: boolean; progress: number }>();
// TTL must be longer than the client poll interval (1s) so the cache is hit
// on most polls, avoiding file I/O that starves WebTorrent's event loop.
const DISK_CHECK_TTL_MS = 5000;

async function checkFileOnDiskCached(infoHash: string, torrentName: string, filePath: string, expectedLength: number): Promise<{ exists: boolean; progress: number }> {
  const key = `${infoHash}\u0000${torrentName}\u0000${filePath}\u0000${expectedLength}`;
  const hit = diskCheckCache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) {
    return hit;
  }
  const result = await checkFileOnDisk(infoHash, torrentName, filePath, expectedLength);
  diskCheckCache.set(key, { expiresAt: now + DISK_CHECK_TTL_MS, ...result });
  return result;
}

// Throttle the per-poll metadata JSON writes (another sync fs.writeFileSync
// that runs on the event loop every poll). Only persist when progress has
// moved by a meaningful amount or when enough time has passed.
const lastMetaWrite = new Map<string, number>();
const META_WRITE_INTERVAL_MS = 5000;

function shouldWriteMeta(infoHash: string, stats: any): boolean {
  const last = lastMetaWrite.get(infoHash) || 0;
  const now = Date.now();
  if (now - last >= META_WRITE_INTERVAL_MS) {
    lastMetaWrite.set(infoHash, now);
    return true;
  }
  return false;
}

const TORRENTS_JSON_PATH = path.join(process.cwd(), '.torrents', 'torrents.json');

const PUBLIC_TRACKERS = [
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
];

function addTrackersToMagnet(magnet: string): string {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:')) {
    return magnet;
  }
  // Extract hostnames of existing trackers to avoid duplicates
  const existingTrackerHosts = new Set<string>();
  const trMatches = magnet.matchAll(/[?&]tr=([^&]+)/g);
  for (const m of trMatches) {
    try {
      const decoded = decodeURIComponent(m[1]);
      const url = new URL(decoded);
      existingTrackerHosts.add(url.hostname);
    } catch {
      // not a valid URL tracker, skip
    }
  }
  let updated = magnet;
  PUBLIC_TRACKERS.forEach(tr => {
    try {
      const trUrl = new URL(tr);
      if (!existingTrackerHosts.has(trUrl.hostname)) {
        updated += `&tr=${encodeURIComponent(tr)}`;
      }
    } catch {
      // bad tracker URL, skip
    }
  });
  return updated;
}

async function saveMagnet(magnet: string) {
  if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
    try {
      let saved: string[] = [];
      const dirOfTorrents = path.join(process.cwd(), '.torrents');
      await fsAsync.mkdir(dirOfTorrents, { recursive: true });
      try {
        const data = await fsAsync.readFile(TORRENTS_JSON_PATH, 'utf8');
        saved = JSON.parse(data);
      } catch {
        saved = [];
      }
      if (!saved.includes(magnet)) {
        saved.push(magnet);
        await fsAsync.writeFile(TORRENTS_JSON_PATH, JSON.stringify(saved), 'utf8');
      }
    } catch (err) {
      console.error('Failed to save magnet to json list:', err);
    }
  }
}

async function getCachedTorrentBuffer(infoHash: string): Promise<Buffer | null> {
  try {
    const torrentFilePath = path.join(process.cwd(), '.torrents', `${infoHash.toLowerCase()}.torrent`);
    try {
      return await fsAsync.readFile(torrentFilePath);
    } catch {
      return null;
    }
  } catch (err) {
    console.error('Failed to read cached torrent file:', err);
  }
  return null;
}

async function saveTorrentFile(torrent: any) {
  try {
    if (!torrent || !torrent.infoHash || !torrent.torrentFile) return;
    const torrentsDir = path.join(process.cwd(), '.torrents');
    await fsAsync.mkdir(torrentsDir, { recursive: true });
    const torrentFilePath = path.join(torrentsDir, `${torrent.infoHash.toLowerCase()}.torrent`);
    try {
      await fsAsync.access(torrentFilePath);
    } catch {
      await fsAsync.writeFile(torrentFilePath, torrent.torrentFile);
      console.log(`Saved torrent file meta-cache for persistent recovery: ${torrent.infoHash}.torrent`);
    }
  } catch (err) {
    console.error('Failed to save torrent file meta-cache:', err);
  }
}

async function saveTorrentMetadataJson(torrent: any, stats: any) {
  try {
    if (!torrent || !torrent.infoHash || !stats) return;
    const torrentsDir = path.join(process.cwd(), '.torrents');
    await fsAsync.mkdir(torrentsDir, { recursive: true });
    const metaPath = path.join(torrentsDir, `${torrent.infoHash.toLowerCase()}.json`);
    if (stats.ready) {
      await fsAsync.writeFile(metaPath, JSON.stringify(stats, null, 2), 'utf8');
      invalidateCachedStats(torrent.infoHash);
      console.log(`Saved torrent metadata JSON cache for ${torrent.infoHash}`);
    }
  } catch (err) {
    console.error('Failed to save torrent metadata JSON cache:', err);
  }
}

// TTL cache for cached-torrent metadata JSON reads. The stats poll reads this
// file synchronously for every torrent on every request; during a heavy
// download that disk I/O starves the event loop and the API times out. Serve
// the last-read copy from memory for a few seconds instead.
const cachedStatsCache = new Map<string, { expiresAt: number; stats: any }>();
const CACHED_STATS_TTL_MS = 5000;

async function getCachedTorrentStats(infoHash: string) {
  try {
    const key = infoHash.toLowerCase();
    const now = Date.now();
    const hit = cachedStatsCache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.stats;
    }
    const metaPath = path.join(process.cwd(), '.torrents', `${key}.json`);
    let stats = null;
    try {
      const data = await fsAsync.readFile(metaPath, 'utf8');
      stats = JSON.parse(data);
    } catch {
      // file doesn't exist or parse error
    }
    cachedStatsCache.set(key, { expiresAt: now + CACHED_STATS_TTL_MS, stats });
    return stats;
  } catch (err) {
    console.error('Failed to read cached torrent metadata JSON:', err);
  }
  return null;
}

// Invalidate the TTL cache when we persist fresh stats so subsequent polls
// pick up the new state immediately instead of stale cached JSON.
function invalidateCachedStats(infoHash: string) {
  cachedStatsCache.delete(String(infoHash).toLowerCase());
}

function cleanupTorrentMaps(infoHash: string) {
  const h = String(infoHash).toLowerCase();
  speedSamples.delete(h);
  diskCheckCache.forEach((_, key) => {
    if (key.startsWith(h + '\u0000')) diskCheckCache.delete(key);
  });
  cachedStatsCache.delete(h);
  lastMetaWrite.delete(h);
}

// Candidate roots where completed torrent file data may live on disk.
// 1. The WebTorrent download directory (torrent.path / process.cwd()/.torrents).
// 2. The legacy `.torrent-cache/streams/torrent-stream/<infoHash>/` layout used
//    by earlier builds of this server. Existing completed downloads from those
//    builds must keep serving without re-downloading.
function getTorrentDataRoots(infoHash: string): string[] {
  const roots: string[] = [];
  const cwd = process.cwd();
  roots.push(path.join(cwd, '.torrents'));
  roots.push(path.join(cwd, '.torrent-cache', 'streams', 'torrent-stream', String(infoHash).toLowerCase()));
  // The legacy cache may sit at the project root one level above the server
  // working directory (e.g. streamtor/ vs the repo root).
  const parent = path.dirname(cwd);
  roots.push(path.join(parent, '.torrent-cache', 'streams', 'torrent-stream', String(infoHash).toLowerCase()));
  return roots;
}

async function findFileOnDisk(infoHash: string, torrentName: string, filePath: string): Promise<string | null> {
  const candidates: string[] = [];
  for (const root of getTorrentDataRoots(infoHash)) {
    if (!root) continue;
    candidates.push(path.join(root, filePath));                 // subdir/file
    candidates.push(path.join(root, path.basename(filePath)));  // flat file
    if (torrentName) {
      candidates.push(path.join(root, torrentName, filePath));  // torrentName/file
      candidates.push(path.join(root, torrentName, path.basename(filePath)));
    }
  }
  // Run all stat calls in parallel instead of sequentially — this reduces
  // per-file lookup from ~12 sequential syscalls to a single parallel batch,
  // dramatically cutting event-loop I/O pressure during stats polling.
  const results = await Promise.allSettled(candidates.map(async (candidate) => {
    const stats = await fsAsync.stat(candidate);
    if (stats.isFile()) return candidate;
    return null;
  }));
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}

async function checkFileOnDisk(infoHash: string, torrentName: string, filePath: string, expectedLength: number): Promise<{ exists: boolean; progress: number }> {
  try {
    // findFileOnDisk already does stat() on each candidate — reuse its
    // result by doing our own parallel stat on just the primary paths
    // instead of calling findFileOnDisk + a second stat().
    const candidates: string[] = [];
    for (const root of getTorrentDataRoots(infoHash)) {
      if (!root) continue;
      candidates.push(path.join(root, filePath));
      candidates.push(path.join(root, path.basename(filePath)));
      if (torrentName) {
        candidates.push(path.join(root, torrentName, filePath));
        candidates.push(path.join(root, torrentName, path.basename(filePath)));
      }
    }
    const results = await Promise.allSettled(candidates.map(async (candidate) => {
      const s = await fsAsync.stat(candidate);
      if (s.isFile()) return s;
      return null;
    }));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        const s = r.value;
        if (s.size >= expectedLength) return { exists: true, progress: 1 };
        return { exists: true, progress: Math.min(s.size / expectedLength, 0.99) };
      }
    }
  } catch (err) {
    // ignore
  }
  return { exists: false, progress: 0 };
}

async function loadSavedMagnets() {
  try {
    const torrentsDir = path.join(process.cwd(), '.torrents');
    await fsAsync.mkdir(torrentsDir, { recursive: true });

    // 1. Scan and restore full *.torrent files (loaded with complete metadata instantly without DHT!)
    const files = await fsAsync.readdir(torrentsDir);
    let restoredCaches = 0;
    for (const file of files) {
      if (file.toLowerCase().endsWith('.torrent')) {
        try {
          const infoHash = file.slice(0, -8).toLowerCase();
          const cached = await getCachedTorrentStats(infoHash);
          if (cached && cached.done) {
            console.log(`Bypassing torrent restore for completed cache to save resources: ${file}`);
            continue;
          }
          const torrentFilePath = path.join(torrentsDir, file);
          const torrentBuffer = await fsAsync.readFile(torrentFilePath);
          console.log(`Restoring persistent torrent meta-cache file: ${file}`);
          client.add(torrentBuffer, {
            path: torrentsDir,
            announce: PUBLIC_TRACKERS,
            strategy: 'rarest',
            maxPeers: 200,
            maxConns: 200,
            maxWebConns: 50,
            uploads: 20,
          } as any);
          restoredCaches++;
        } catch (e) {
          console.error(`Failed to restore persistent torrent file ${file}:`, e);
        }
      }
    }

    // 2. Scan and restore raw magnet links
    try {
      const data = await fsAsync.readFile(TORRENTS_JSON_PATH, 'utf8');
      const saved: string[] = JSON.parse(data);
      for (const magnet of saved) {
        try {
          const trackerMagnet = addTrackersToMagnet(magnet);
          const infoHashMatch = trackerMagnet.match(/btih:([a-fA-F0-9]{40})/);
          const infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : '';
          
          if (infoHash) {
            const cached = await getCachedTorrentStats(infoHash);
            if (cached && cached.done) {
              console.log(`Bypassing magnet restore for completed cache to save resources: ${infoHash}`);
              continue;
            }
          }
          
          // Only add magnet if the full .torrent meta-cache file was not already loaded
          const hasCache = infoHash ? files.includes(`${infoHash}.torrent`) : false;
          if (!hasCache) {
            console.log('Restoring saved torrent magnet:', trackerMagnet.slice(0, 50));
            client.add(trackerMagnet, { 
              path: torrentsDir,
              strategy: 'rarest',
              announce: PUBLIC_TRACKERS,
              maxPeers: 200,
              maxConns: 200,
              maxWebConns: 50,
              uploads: 20,
            } as any);
          }
        } catch (e) {
          console.error('Failed to restore saved magnet:', e);
        }
      }
    } catch {
      // torrents.json doesn't exist yet
    }
  } catch (err) {
    console.error('Failed to load saved magnets:', err);
  }
}

async function startServer() {
  // Initialize and restore saved magnet links from previous sessions/dev server reboots
  await loadSavedMagnets();

  const app = express();
  app.disable('x-powered-by');
  // Prefer STREAMTOR_PORT: on Fly.io the platform injects PORT=8080 for the
  // backend's internal_port, and streamtor must stay on its own port (3002)
  // inside the same container rather than grabbing that injected value.
  const PORT = Number(process.env.STREAMTOR_PORT) || 3002;

  // Internal shared-secret. When set, every /api/* route requires it via the
  // X-Internal-Token header (or the HttpOnly streamtor_token cookie issued to
  // the same-origin UI below). Leave unset only for local dev.
  const internalToken = process.env.STREAMTOR_INTERNAL_TOKEN || '';
  if (!internalToken) {
    console.warn('[security] STREAMTOR_INTERNAL_TOKEN is not set — torrent API is NOT authenticated. Set it before exposing beyond localhost.');
  }

  // Custom CORS/Preflight support. Restrict to the configured allowlist instead
  // of '*'; defaults to the local frontend origins. API auth uses the internal
  // token header (not cookies), so credentials stay false.
  const corsOrigins = (process.env.STREAMTOR_CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      // Allow if origin is in the allowlist, or if it's a LAN IP (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      const isAllowed = corsOrigins.includes(origin) || /https?:\/\/(192\.168|10|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(:\d+)?/.test(origin);
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Token');
      }
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // Gate every /api/* route on the internal token (header or same-origin cookie).
  app.use('/api', (req, res, next) => {
    if (!internalToken) {
      return next();
    }
    const headerToken = String(req.headers['x-internal-token'] || '');
    const cookieToken = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('streamtor_token='));
    const cookieValue = cookieToken ? cookieToken.slice('streamtor_token='.length) : '';
    if (headerToken === internalToken || cookieValue === internalToken) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized. Missing or invalid internal token.' });
  });

  // Same-origin UI: issue an HttpOnly cookie so its /api calls authenticate
  // without the secret ever reaching client-side JS. Only set when the token
  // is configured.
  app.use((req, res, next) => {
    if (internalToken && req.path === '/' && req.method === 'GET') {
      res.setHeader('Set-Cookie', `streamtor_token=${internalToken}; Path=/; HttpOnly; SameSite=Lax`);
    }
    next();
  });

  // API to add a torrent and get its metadata
  app.post('/api/torrents', async (req, res) => {
    const { magnet } = req.body;
    if (!magnet) {
      return res.status(400).json({ error: 'Magnet link required' });
    }

    // If we already have the full .torrent metadata cached (from a prior
      // session), use that instead of the magnet so metadata is instant and
      // the download resumes without a cold DHT/metadata bootstrap.
      let torrentId: string | Buffer = magnet;
      if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
        const infoHashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/);
        const cachedBh = infoHashMatch ? infoHashMatch[1].toLowerCase() : '';
        const cachedBuf = cachedBh ? await getCachedTorrentBuffer(cachedBh) : null;
        if (cachedBuf) {
          torrentId = cachedBuf;
        } else {
          torrentId = addTrackersToMagnet(magnet);
        }
      } else if (typeof magnet === 'string' && magnet.startsWith('data:')) {
        try {
          const base64Data = magnet.split(',')[1];
          if (base64Data) {
            torrentId = Buffer.from(base64Data, 'base64');
          }
        } catch (err) {
          return res.status(400).json({ error: 'Invalid base64 torrent data' });
        }
      }

    try {
      let torrent: any = null;

      // Check if it's already in the client before adding to prevent duplicate exceptions
      if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
        const infoHashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/);
        const h = infoHashMatch ? infoHashMatch[1].toLowerCase() : '';
        if (h) {
          try {
            torrent = await client.get(h);
          } catch (e) {
            torrent = null;
          }
        }
      }

      if (!torrent) {
        try {
torrent = client.add(torrentId, { 
            path: path.join(process.cwd(), '.torrents'),
            announce: PUBLIC_TRACKERS,
            strategy: 'rarest',
            // Per-torrent settings for maximum throughput
            maxPeers: 200,
            maxConns: 200,
            maxWebConns: 50,
            uploads: 20,
          } as any);
        } catch (addErr: any) {
          // If duplicate error, safely retrieve the existing torrent from client
          if (addErr.message && addErr.message.toLowerCase().includes('duplicate')) {
            const match = addErr.message.match(/([a-fA-F0-9]{40})/);
            const h = match ? match[1].toLowerCase() : '';
            if (h) {
              try {
                torrent = await client.get(h);
              } catch (e) {
                torrent = null;
              }
            }
          }
          if (!torrent) throw addErr;
        }
      }

      // Save the magnet link for startup persistence
      await saveMagnet(magnet);

      if (torrent.ready) {
        saveTorrentFile(torrent);
        return res.json(await getTorrentStats(torrent));
      }

      torrent.on('ready', () => {
        saveTorrentFile(torrent);
      });
      torrent.on('done', () => {
        saveTorrentFile(torrent);
      });

      // Respond immediately (metadata still fetching) so the client sees the
      // torrent in Active Downloads right away instead of a long hang.
      try {
        const stats = await getTorrentStats(torrent);
        if (!res.headersSent) {
          res.json(stats);
        }
      } catch (e) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to compile torrent stats' });
        }
      }
      
      torrent.on('error', async (err: any) => {
        if (res.headersSent) return;
        const msg = err && err.message ? String(err.message) : String(err);
        // WebTorrent destroys a re-added torrent as a duplicate instead of
        // throwing synchronously. Resolve it to the already-active torrent.
        if (msg.toLowerCase().includes('duplicate')) {
          const match = msg.match(/([a-fA-F0-9]{40})/);
          const h = match ? match[1].toLowerCase() : '';
          if (h) {
            try {
              const existing = await client.get(h);
              if (existing && existing.ready) {
                saveTorrentFile(existing);
                return res.json(await getTorrentStats(existing));
              }
            } catch (e) {
              // fall through to 500 below
            }
          }
        }
        res.status(500).json({ error: msg });
      });

    } catch (err: any) {
      if (!res.headersSent) {
         res.status(500).json({ error: err.message || 'Failed to process torrent' });
      }
    }
  });

  // API to get all active torrents state
  app.get('/api/torrents', async (req, res) => {
    try {
      if (!client || !client.torrents) {
        return res.json([]);
      }

      const allStats: any[] = [];

      // Live torrents: always compute fresh stats directly from the
      // WebTorrent torrent object. Never mix in stale JSON-cached data
      // which causes progress to show 0% or get stuck.
      for (const t of client.torrents) {
        const stats = await getTorrentStats(t);
        if (stats) allStats.push(stats);
      }

      // Dead torrents (not in client anymore): serve from JSON cache
      // so the UI still shows completed/removed torrents.
      try {
        const torrentsDir = path.join(process.cwd(), '.torrents');
        const files = await fsAsync.readdir(torrentsDir);
        const liveHashes = new Set(allStats.map(s => s.infoHash.toLowerCase()));
        for (const file of files) {
          if (file.toLowerCase().endsWith('.json') && file.toLowerCase() !== 'torrents.json') {
            const h = file.slice(0, -5).toLowerCase();
            if (liveHashes.has(h)) continue; // already have live stats
            try {
              const cached = await getCachedTorrentStats(h);
              if (cached) {
                allStats.push({
                  ...cached,
                  numPeers: 0,
                  downloadSpeed: 0,
                  uploadSpeed: 0,
                });
              }
            } catch {}
          }
        }
      } catch {
        // .torrents dir may not exist
      }

      res.json(allStats);
    } catch (err) {
      console.error('Error fetching torrents:', err);
      res.json([]);
    }
  });

  // API to pause / resume / remove a specific torrent
  app.post('/api/torrents/:infoHash/action', async (req, res) => {
    try {
      const { infoHash } = req.params;
      const { action } = req.body || {};

      if (!infoHash || !action) {
        return res.status(400).json({ error: 'infoHash and action are required' });
      }

      const h = infoHash.toLowerCase();
      // WebTorrent 3.x `client.get()` is async (returns a Promise<Torrent>).
      let torrent: any = null;
      try {
        torrent = await client.get(h);
      } catch (e) {
        torrent = null;
      }

      const torrentsDir = path.join(process.cwd(), '.torrents');

      // Torrent is not live in the client, but may still have cached metadata
      // from a previous session (survived a cleanup wipe). Handle those here so
      // pause / resume / remove never hard-404 from stale UI entries.
      if (!torrent) {
        if (action === 'remove') {
          // Remove cached-only torrents regardless of live client state.
          try {
            const metaPath = path.join(torrentsDir, `${h}.json`);
            try { await fsAsync.unlink(metaPath); } catch {}
            const torrentFilePath = path.join(torrentsDir, `${h}.torrent`);
            try { await fsAsync.unlink(torrentFilePath); } catch {}
            // Delete any partially/fully downloaded data files listed in the
            // cached metadata so a "remove" frees disk space like live removes.
            try {
              const cached = await getCachedTorrentStats(h);
              if (cached && cached.files && Array.isArray(cached.files)) {
                for (const f of cached.files) {
                  const name = f.name || f.path || '';
                  if (!name) continue;
                  const base = path.basename(name);
                  const candidates = [path.join(torrentsDir, base), path.join(torrentsDir, name)];
                  for (const p of candidates) {
                    try {
                      await fsAsync.unlink(p);
                      console.log(`Removed cached data file: ${base}`);
                    } catch {}
                  }
                }
              }
            } catch (e) {
              // non-fatal
            }
            try {
              const data = await fsAsync.readFile(TORRENTS_JSON_PATH, 'utf8');
              const saved = JSON.parse(data) as string[];
              await fsAsync.writeFile(TORRENTS_JSON_PATH, JSON.stringify(saved.filter((m) => !m.includes(h)), null, 2), 'utf8');
            } catch {}
          } catch (err) {
            console.error('Failed to clean cached-only torrent on remove:', err);
          }
          console.log(`Removed cached-only torrent ${h}`);
          cleanupTorrentMaps(h);
          return res.json({ infoHash: h, removed: true, cachedOnly: true });
        }

        if (action === 'resume') {
          // Torrent is no longer in the client (e.g. cleared from memory but its
          // .torrent meta-cache survived). Re-add it instantly so the download
          // resumes without waiting on a cold DHT/metadata bootstrap.
          const torrentBuffer = await getCachedTorrentBuffer(h);
          if (torrentBuffer) {
            console.log(`Resuming cached-only torrent ${h} from torrent meta-cache`);
torrent = await client.add(torrentBuffer, { 
            path: torrentsDir, 
            announce: PUBLIC_TRACKERS, 
            strategy: 'rarest',
            maxPeers: 200,
            maxConns: 200,
            maxWebConns: 50,
            uploads: 20,
          } as any);
          } else {
            try {
              const data = await fsAsync.readFile(TORRENTS_JSON_PATH, 'utf8');
              const saved = JSON.parse(data) as string[];
              const magnet = saved.find((m) => m.toLowerCase().includes(h));
              if (magnet) {
                console.log(`Resuming cached-only torrent ${h} from saved magnet`);
                torrent = await client.add(addTrackersToMagnet(magnet), { 
              path: torrentsDir, 
              announce: PUBLIC_TRACKERS,
              strategy: 'rarest',
              maxPeers: 200,
              maxConns: 200,
              maxWebConns: 50,
              uploads: 20,
            } as any);
              }
            } catch {}
          }
          if (!torrent) {
            const cached = await getCachedTorrentStats(h);
            if (cached && cached.ready) {
              console.log(`No recoverable source for cached-only torrent ${h}`);
            }
            return res.status(404).json({ error: `No recoverable torrent metadata for ${infoHash}` });
          }
        } else {
          return res.status(404).json({ error: `Torrent not found: ${infoHash}` });
        }
      }

      switch (action) {
        case 'pause':
          resetSpeedSmoothing(h);
          torrent.pause();
          break;
        case 'resume':
          resetSpeedSmoothing(h);
          torrent.resume();
          break;
        case 'remove': {
          const name = torrent.name || h;
          client.remove(h, { destroyStore: true }, () => {
            // Delete the on-disk meta caches for this infoHash so it does not
            // get auto-restored on the next server start.
            (async () => {
              try {
                const dir = path.join(process.cwd(), '.torrents');
                try {
                  const data = await fsAsync.readFile(path.join(dir, 'torrents.json'), 'utf8');
                  const saved = JSON.parse(data) as string[];
                  await fsAsync.writeFile(path.join(dir, 'torrents.json'), JSON.stringify(saved.filter((m) => !m.includes(h)), null, 2), 'utf8');
                } catch {}
                try { await fsAsync.unlink(path.join(dir, `${h}.json`)); } catch {}
                try { await fsAsync.unlink(path.join(dir, `${h}.torrent`)); } catch {}
              } catch (err) {
                console.error('Failed to clean meta cache on remove:', err);
              }
              console.log(`Removed torrent ${h} (${name})`);
              cleanupTorrentMaps(h);
            })();
          });
          return res.json({ infoHash: h, removed: true });
        }
        default:
          return res.status(400).json({ error: `Unsupported action: ${action}` });
      }

      const stats = await getTorrentStats(torrent);
      return res.json(stats);
    } catch (err: any) {
      console.error('Torrent action error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to perform action on torrent' });
      }
    }
  });

  // API to remove all active torrents and clean cached files from disk
  app.post('/api/torrents/cleanup', async (req, res) => {
    try {
      let removed = 0;
      if (client && client.torrents) {
        client.torrents.slice().forEach(t => {
          client.remove((t as any).infoHash, { destroyStore: true });
          removed++;
        });
      }

      // Remove stats JSON + downloaded data caches, but KEEP the compact
      // `.torrent` metadata files and the saved magnet list. That way a
      // re-add of the same file restores its full metadata instantly and
      // resumes at once instead of bootstrapping metadata from peers anew.
      const torrentsDir = path.join(process.cwd(), '.torrents');
      try {
        const files = await fsAsync.readdir(torrentsDir);
        for (const file of files) {
          if (file.toLowerCase().endsWith('.json') && file.toLowerCase() !== 'torrents.json') {
            const p = path.join(torrentsDir, file);
            const h = file.slice(0, -5).toLowerCase();
            const metaPath = path.join(torrentsDir, `${h}.torrent`);
            try {
              await fsAsync.access(metaPath);
            } catch {
              // .torrent meta cache doesn't exist, safe to delete the JSON
              await fsAsync.unlink(p);
            }
          }
        }
      } catch {
        // .torrents dir may not exist
      }

      res.json({ deleted: removed });
    } catch (err) {
      console.error('Torrent cleanup error:', err);
      res.status(500).json({ error: 'Failed to clean torrent caches' });
    }
  });

  // API to select/deselect files for download (prioritize specific files)
  app.post('/api/torrents/:infoHash/select', async (req, res) => {
    try {
      const { infoHash } = req.params;
      const { fileIndices } = req.body; // array of file indices to download
      const h = infoHash.toLowerCase();

      let torrent: any = null;
      try {
        torrent = await client.get(h);
      } catch (e) {
        torrent = null;
      }

      if (!torrent) {
        return res.status(404).json({ error: 'Torrent not found' });
      }

      if (!Array.isArray(fileIndices) || !torrent.files || !torrent.files.length) {
        return res.status(400).json({ error: 'Invalid fileIndices or no files in torrent' });
      }

      torrent.files.forEach((f: any, i: number) => {
        if (fileIndices.includes(i)) {
          f.select();
        } else {
          f.deselect();
        }
      });

      console.log(`Torrent ${h}: selected files [${fileIndices.join(',')}]`);
      return res.json({ infoHash: h, selectedFiles: fileIndices });
    } catch (err: any) {
      console.error('File selection error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to select files' });
      }
    }
  });

  // API to download a specific file natively via HTTP streaming
  app.get('/api/torrents/:infoHash/files/:fileIndex', async (req, res) => {
    try {
      const { infoHash, fileIndex } = req.params;
      const h = infoHash.toLowerCase();
      
      let torrent: any = null;
      try {
        torrent = await client.get(h);
      } catch (e) {
        torrent = null;
      }
      let file: any = null;
      let torrentPath = path.join(process.cwd(), '.torrents');
      let fileName = '';
      let filePath = '';
      let fileLength = 0;

      if (torrent && torrent.ready && torrent.files) {
        file = torrent.files[parseInt(fileIndex, 10)];
        if (file) {
          fileName = file.name;
          filePath = file.path;
          fileLength = file.length;
          torrentPath = torrent.path || torrentPath;
        }
      }

      if (!file) {
        const cached = await getCachedTorrentStats(h);
        if (cached && cached.ready && cached.files) {
          const cachedFile = cached.files[parseInt(fileIndex, 10)];
          if (cachedFile) {
            fileName = cachedFile.name;
            filePath = cachedFile.path || cachedFile.name;
            fileLength = cachedFile.length;
          }
        }
      }

      if (!fileName) {
        return res.status(404).send('Torrent metadata or file mapping not found. Please wait for torrent initialization.');
      }

      let absPath = '';
      if (filePath) {
        absPath = path.isAbsolute(filePath) ? filePath : path.join(torrentPath, filePath);
      } else {
        absPath = path.join(torrentPath, fileName);
      }

      try {
        await fsAsync.access(absPath);
      } catch {
        absPath = path.join(process.cwd(), '.torrents', fileName);
      }

      // Fall back to scanning all candidate data roots (WebTorrent download
      // dir + legacy .torrent-cache/streams/torrent-stream/<infoHash> layout).
      try {
        await fsAsync.access(absPath);
      } catch {
        const resolved = await findFileOnDisk(h, fileName, filePath);
        if (resolved) {
          absPath = resolved;
        }
      }

      try {
        await fsAsync.access(absPath);
      } catch {
        console.error('File does not exist on disk at path:', absPath);
        return res.status(404).send(`File not found on disk: ${fileName}`);
      }

      const diskStats = await fsAsync.stat(absPath);
      const availableBytes = diskStats.size;

      // If file has zero bytes, it hasn't started downloading yet
      if (availableBytes === 0) {
        return res.status(400).send('File has no data on disk yet. Please wait for the download to start.');
      }

      // If the file is incomplete, serve what we have (partial download).
      // The browser will receive whatever bytes are available. For large files
      // this means users can save partially-downloaded content.
      const isCompleteOnDisk = availableBytes >= fileLength;

      console.log('Serving fully completed file natively from server disk:', absPath);

      // Web browsers request ranges for smooth seeking and resuming downloads
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '\\"')}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10) || 0;
        const end = (parts[1] && parts[1].trim() !== '') ? parseInt(parts[1], 10) : availableBytes - 1;
        
        if (start >= availableBytes || start > end) {
          res.setHeader('Content-Range', `bytes */${availableBytes}`);
          return res.status(416).send('Requested Range Not Satisfiable');
        }

        const clampedEnd = Math.min(end, availableBytes - 1);
        const chunksize = (clampedEnd - start) + 1;
        
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${clampedEnd}/${fileLength}`);
        res.setHeader('Content-Length', chunksize);
        
        const rstream = fs.createReadStream(absPath, { start, end: clampedEnd });
        rstream.pipe(res);
        rstream.on('error', (err: any) => {
          console.error('Range Stream Error:', err);
          if (!res.headersSent) res.status(500).end();
        });
      } else {
        // Remove Content-Length to force Chunked Transfer Encoding.
        // Extremely important to bypass Google Frontend (GFE) 32MB single buffered response size limit on Cloud Run!
        res.removeHeader('Content-Length');
        
        // For incomplete files, add a header so the client knows the total expected size
        if (!isCompleteOnDisk) {
          res.setHeader('X-Content-Total', fileLength);
          res.setHeader('X-Content-Available', availableBytes);
        }
        
        const fileStream = fs.createReadStream(absPath);
        fileStream.on('error', (streamErr) => {
          console.error('Full Stream Error:', streamErr);
          if (!res.headersSent) {
            res.status(500).send('Error streaming file');
          }
        });
        fileStream.pipe(res);
      }
    } catch (err: any) {
      console.error('Stream endpoint error:', err);
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error while streaming file');
      }
    }
  });

  // ── Direct Torrent Download Endpoint (No Disk Cache) ───────────────────────
  // Streams torrent data directly to client without storing in .torrents directory.
  // Supports: Range headers for resumable downloads, multi-file torrent selection.
  app.get('/api/torrents/:infoHash/stream', async (req, res) => {
    try {
      const { infoHash } = req.params;
      const { file: fileQuery } = req.query; // Optional: specify file in multi-file torrent
      const h = infoHash.toLowerCase();

      let torrent: any = null;
      try {
        torrent = await client.get(h);
      } catch (e) {
        torrent = null;
      }

      // If torrent not in memory, try to restore from cached .torrent file
      if (!torrent || !torrent.ready) {
        const torrentBuffer = await getCachedTorrentBuffer(h);
        if (torrentBuffer) {
          console.log(`[Direct Stream] Restoring torrent from cache: ${h}`);
          torrent = client.add(torrentBuffer, {
            path: path.join(process.cwd(), '.torrents'),
            announce: PUBLIC_TRACKERS,
            strategy: 'rarest',
            maxPeers: 200,
            maxConns: 200,
            maxWebConns: 50,
            uploads: 20,
          } as any);
          // Wait for ready state
          await new Promise<void>((resolve, reject) => {
            if (torrent.ready) { resolve(); return; }
            torrent.on('ready', () => resolve());
            torrent.on('error', (err: any) => reject(err));
            setTimeout(() => reject(new Error('Torrent metadata timeout')), 30000);
          });
        }
      }

      if (!torrent || !torrent.ready) {
        return res.status(404).json({ error: 'Torrent not found or metadata not available' });
      }

      // Select file to stream
      let file: any = null;
      if (fileQuery && typeof fileQuery === 'string') {
        file = torrent.files.find((f: any) => f.name === fileQuery || f.path === fileQuery);
      }
      if (!file && torrent.files && torrent.files.length > 0) {
        file = torrent.files[0]; // Default to first file
      }

      if (!file) {
        return res.status(404).json({ error: 'No files available in torrent' });
      }

      const fileName = file.name || 'download';
      const fileSize = file.length;

      // Set response headers
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '\\"')}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      // Handle Range requests (resumable downloads)
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] && parts[1].trim() !== '' ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          res.setHeader('Content-Range', `bytes */${fileSize}`);
          return res.status(416).send('Requested Range Not Satisfiable');
        }

        const chunksize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunksize);

        console.log(`[Direct Stream] Range request: ${fileName} bytes ${start}-${end}/${fileSize}`);

        const stream = file.createReadStream({ start, end });
        stream.on('error', (err: any) => {
          console.error('[Direct Stream] Stream error:', err);
          if (!res.headersSent) res.status(500).send('Stream error');
        });
        stream.pipe(res);
      } else {
        // Full file download - use chunked transfer encoding
        res.removeHeader('Content-Length');
        console.log(`[Direct Stream] Full download: ${fileName} (${Math.round(fileSize / 1024 / 1024)}MB)`);

        const stream = file.createReadStream();
        stream.on('error', (err: any) => {
          console.error('[Direct Stream] Stream error:', err);
          if (!res.headersSent) res.status(500).send('Stream error');
        });
        stream.pipe(res);
      }
    } catch (err: any) {
      console.error('[Direct Stream] Endpoint error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  // ── Direct Torrent Download with Auto-Add ─────────────────────────────────
  // Accepts magnet/.torrent data, adds torrent, and immediately streams.
  app.post('/api/torrents/stream', async (req, res) => {
    const { magnet, file: fileQuery } = req.body;
    if (!magnet) {
      return res.status(400).json({ error: 'Magnet link or torrent data required' });
    }

    try {
      let torrentId: string | Buffer = magnet;

      // Handle magnet link
      if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
        const infoHashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/);
        const cachedBh = infoHashMatch ? infoHashMatch[1].toLowerCase() : '';
        const cachedBuf = cachedBh ? await getCachedTorrentBuffer(cachedBh) : null;

        if (cachedBuf) {
          torrentId = cachedBuf;
        } else {
          torrentId = addTrackersToMagnet(magnet);
        }
      } else if (typeof magnet === 'string' && magnet.startsWith('data:')) {
        // Handle base64 torrent data
        const base64Data = magnet.split(',')[1];
        if (base64Data) {
          torrentId = Buffer.from(base64Data, 'base64');
        }
      }

      // Check if already added
      let torrent: any = null;
      if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
        const infoHashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/);
        const h = infoHashMatch ? infoHashMatch[1].toLowerCase() : '';
        if (h) {
          try {
            torrent = await client.get(h);
          } catch (e) {
            torrent = null;
          }
        }
      }

      if (!torrent) {
        torrent = client.add(torrentId, {
          path: path.join(process.cwd(), '.torrents'),
          announce: PUBLIC_TRACKERS,
          strategy: 'rarest',
          maxPeers: 200,
          maxConns: 200,
          maxWebConns: 50,
          uploads: 20,
        } as any);
      }

      // Wait for metadata
      if (!torrent.ready) {
        await new Promise<void>((resolve, reject) => {
          torrent.on('ready', () => resolve());
          torrent.on('error', (err: any) => reject(err));
          setTimeout(() => reject(new Error('Metadata fetch timeout')), 60000);
        });
      }

      // Save for persistence
      saveTorrentFile(torrent);

      // Select file
      let file: any = null;
      if (fileQuery && typeof fileQuery === 'string') {
        file = torrent.files.find((f: any) => f.name === fileQuery || f.path === fileQuery);
      }
      if (!file && torrent.files && torrent.files.length > 0) {
        file = torrent.files[0];
      }

      if (!file) {
        return res.status(404).json({ error: 'No files in torrent' });
      }

      const fileName = file.name || 'download';
      const fileSize = file.length;

      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '\\"')}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');

      console.log(`[Direct Stream] Streaming: ${fileName} (${Math.round(fileSize / 1024 / 1024)}MB)`);

      file.createReadStream().pipe(res);
    } catch (err: any) {
      console.error('[Direct Stream] POST error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to stream torrent' });
      }
    }
  });

  // Start listening BEFORE Vite middleware so the API (including /api/torrents
  // health-check) responds immediately while the dev server initialises.
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
  });

  // Graceful shutdown — destroy all torrent connections and close the server
  // so no in-flight downloads are silently dropped during deployment/restart.
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed.');
    });
    try {
      // Destroy all torrents (saves state to disk first if possible)
      await new Promise<void>((resolve) => {
        client.destroy((err) => {
          if (err) console.error('WebTorrent destroy error:', err);
          resolve();
        });
      });
      console.log('WebTorrent client destroyed. Goodbye.');
    } catch (e) {
      console.error('Error destroying WebTorrent client:', e);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Vite middleware for development (loaded after listen so startup is not blocked)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

async function getTorrentStats(t: WebTorrent.Torrent) {
  try {
    if (!t) return null;
    const isReady = t.ready && !(t as any).destroyed;
    const infoHash = (t.infoHash || '').toLowerCase();

    // For live ready torrents, use torrent object directly — no cache reads.
    // Cache is only for non-ready torrents still fetching metadata.
    const cached = isReady ? null : await getCachedTorrentStats(infoHash);
    
    // Compile basic metadata
    const name = t.name || (cached ? cached.name : 'Fetching metadata...');
    const files = t.files || (cached ? cached.files : []);
    const totalLength = t.length || (cached ? cached.length : 0);

    // Compute progress using BOTH wire bytes and piece verification, take the
    // maximum of the two. This prevents "stuck" progress from either source:
    // - t.downloaded / totalLength: wire-level bytes (may lag if not exposed)
    // - t.progress: piece-verified (lags at high speed, but always works)
    // Using max() means progress never goes backwards and always advances.
    let totalDownloaded = 0;

    const processedFiles = files.map((f: any, i: number) => {
      const sizeExpected = f.length || 0;
      const filePath = f.path || f.name || '';
      const fileName = f.name || 'Unknown';

      let downloaded = 0;
      let progress = 0;

      if (isReady && totalLength > 0) {
        // Wire-level proportional share
        const wireBytes = typeof (t as any).downloaded === 'number' ? (t as any).downloaded : 0;
        const wireProgress = wireBytes > 0 ? (wireBytes * (sizeExpected / totalLength)) / sizeExpected : 0;
        // Piece-verified progress for this file
        const pieceProgress = typeof f.progress === 'number' ? Math.min(f.progress, 1) : 0;
        // Use whichever is higher — never go backwards
        progress = Math.max(wireProgress, pieceProgress);
        downloaded = Math.floor(progress * sizeExpected);
      } else if (typeof f.downloaded === 'number' && f.downloaded > 0) {
        downloaded = f.downloaded;
        progress = sizeExpected > 0 ? Math.min(downloaded / sizeExpected, 1) : 0;
      }

      totalDownloaded += downloaded;

      return {
        index: i,
        name: fileName,
        path: filePath,
        length: sizeExpected,
        downloaded: downloaded,
        progress: progress
      };
    });

    // Overall progress: max of wire-level and piece-verified
    const wireProgress = isReady && totalLength > 0 && typeof (t as any).downloaded === 'number'
      ? Math.min((t as any).downloaded / totalLength, 1)
      : 0;
    const pieceProgress = typeof t.progress === 'number' ? Math.min(t.progress, 1) : 0;
    const overallProgress = Math.max(wireProgress, pieceProgress);
    const isDone = overallProgress >= 1.0 || t.done;
    const shownProgress = isDone ? 1 : overallProgress;

    // Downloaded bytes: prefer wire-level, fall back to computed
    const reportedDownloaded = isReady && typeof (t as any).downloaded === 'number' && (t as any).downloaded > 0
      ? (t as any).downloaded
      : totalDownloaded;

    // Speed from byte counter deltas (real-time, not WebTorrent's laggy average)
    const measured = measureTorrentSpeed(
      infoHash,
      (t as any).downloaded || 0,
      (t as any).uploaded || 0
    );

    // Safety: ensure no NaN/Infinity leaks into JSON response
    const safeNum = (v: any, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;

    const stats = {
      infoHash: t.infoHash || '',
      name: name,
      paused: !!(t as any).paused,
      progress: safeNum(shownProgress, 0),
      downloadSpeed: safeNum(measured.down, 0),
      uploadSpeed: safeNum(measured.up, 0),
      numPeers: safeNum(t.numPeers, 0),
      length: safeNum(totalLength, 0),
      downloaded: safeNum(reportedDownloaded, 0),
      timeRemaining: isDone ? 0 : safeNum(t.timeRemaining, 0),
      done: isDone,
      ready: isReady || (processedFiles.length > 0),
      files: processedFiles.map(f => ({
        ...f,
        progress: safeNum(f.progress, 0),
        downloaded: safeNum(f.downloaded, 0),
        length: safeNum(f.length, 0),
      }))
    };

    // If the torrent just achieved ready status in memory, cache its metadata json
    if (isReady && t.files && t.files.length > 0 && shouldWriteMeta(infoHash, stats)) {
      saveTorrentMetadataJson(t, stats);
    }

    // Keep completed torrents alive for seeding (configurable via STREAMTOR_SEED_DURATION_MINUTES)
    // Default: 5 minutes of seeding after completion before potential cleanup
    const seedDurationMinutes = Number(process.env.STREAMTOR_SEED_DURATION_MINUTES) || 5;
    if (isDone && !(t as any)._handlingDone && isReady) {
      (t as any)._handlingDone = true;
      saveTorrentMetadataJson(t, stats);
      saveTorrentFile(t);
      // Schedule cleanup after seeding period instead of immediate destroy
      setTimeout(() => {
        try {
          console.log(`Seeding period ended for ${t.infoHash} after ${seedDurationMinutes} minutes`);
          // Note: Not calling t.destroy() to keep the torrent available for re-download/streaming
          // The torrent remains in the client for future access
        } catch (e) {
          // ignore
        }
      }, seedDurationMinutes * 60 * 1000);
    }

    return stats;
  } catch (err) {
    console.error('Error getting torrent stats:', err);
    if (t && t.infoHash) {
      const cached = getCachedTorrentStats(t.infoHash.toLowerCase());
      if (cached) {
        return cached;
      }
    }
    return {
      infoHash: t ? t.infoHash : '',
      name: (t && t.name) ? t.name : 'Error fetching stats',
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      length: 0,
      downloaded: 0,
      timeRemaining: 0,
      done: false,
      ready: false,
      files: []
    };
  }
}

startServer().catch(console.error);
