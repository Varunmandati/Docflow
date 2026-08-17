import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import WebTorrent from 'webtorrent';
import 'dotenv/config';

const client = new WebTorrent({
  maxConns: 500,
  maxWebConns: 30,
  // uTP adds ~4x throughput penalty over TCP (its congestion control is
  // extremely conservative), measured ~0.3 MB/s vs ~1.2 MB/s on a well-seeded
  // torrent with identical peers. TCP is universally supported by seeders,
  // so disabling uTP gets real multi-MB/s downloads.
  utp: false,
  dht: true,
  tracker: true,
  downloadLimit: -1,
  uploadLimit: -1
} as any);

client.on('error', (err: any) => {
  console.error('Global WebTorrent error:', err);
});

// Speed measurement. Instead of double-smoothing WebTorrent's own EMA
// speedometer (which lags real throughput at slow poll rates), measure the
// actual delta of downloaded/uploaded bytes between polls. That is the real
// speed the user is getting. A light EMA on top only dampens single-sample
// jitter so the UI stays readable.
const speedBaseline = new Map<string, { downloaded: number; uploaded: number; ts: number; down: number; up: number }>();
const SPEED_SMOOTHING_ALPHA = 0.5;

function measureTorrentSpeed(infoHash: string, downloadedBytes: number, uploadedBytes: number, fallbackDown: number, fallbackUp: number) {
  const now = Date.now();
  const prev = speedBaseline.get(infoHash);
  if (prev && now - prev.ts >= 500) {
    const dt = (now - prev.ts) / 1000;
    const deltaDown = Math.max(0, downloadedBytes - prev.downloaded);
    const deltaUp = Math.max(0, uploadedBytes - prev.uploaded);
    const measuredDown = dt > 0 ? deltaDown / dt : fallbackDown;
    const measuredUp = dt > 0 ? deltaUp / dt : fallbackUp;
    // Light EMA to dampen jitter while still tracking real throughput closely.
    const down = prev.down + SPEED_SMOOTHING_ALPHA * (measuredDown - prev.down);
    const up = prev.up + SPEED_SMOOTHING_ALPHA * (measuredUp - prev.up);
    speedBaseline.set(infoHash, { downloaded: downloadedBytes, uploaded: uploadedBytes, ts: now, down, up });
    return { down, up };
  }
  if (!prev) {
    speedBaseline.set(infoHash, { downloaded: downloadedBytes, uploaded: uploadedBytes, ts: now, down: fallbackDown, up: fallbackUp });
    return { down: fallbackDown, up: fallbackUp };
  }
  // Poll arrived faster than the measurement window — reuse the last measured
  // speed instead of WebTorrent's own laggy 5s average. This keeps the
  // displayed speed stable and truthful between polls.
  return { down: prev.down, up: prev.up };
}

function resetSpeedSmoothing(infoHash: string) {
  speedBaseline.delete(infoHash);
}

// TTL cache for on-disk progress checks. Without this, every stats poll
// runs synchronous fs.statSync/fs.existsSync for every file of every torrent,
// which blocks the Node event loop that is also servicing the actual
// WebTorrent download traffic, throttling real download speeds.
const diskCheckCache = new Map<string, { expiresAt: number; exists: boolean; progress: number }>();
const DISK_CHECK_TTL_MS = 4000;

function checkFileOnDiskCached(torrentName: string, filePath: string, expectedLength: number): { exists: boolean; progress: number } {
  const key = `${torrentName}\u0000${filePath}\u0000${expectedLength}`;
  const hit = diskCheckCache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) {
    return hit;
  }
  const result = checkFileOnDisk(torrentName, filePath, expectedLength);
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
  'udp://tracker.dler.org:6969/announce'
];

function addTrackersToMagnet(magnet: string): string {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:')) {
    return magnet;
  }
  let updated = magnet;
  PUBLIC_TRACKERS.forEach(tr => {
    if (!updated.includes(encodeURIComponent(tr))) {
      updated += `&tr=${encodeURIComponent(tr)}`;
    }
  });
  return updated;
}

function saveMagnet(magnet: string) {
  if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
    try {
      let saved: string[] = [];
      const dirOfTorrents = path.join(process.cwd(), '.torrents');
      if (!fs.existsSync(dirOfTorrents)) {
        fs.mkdirSync(dirOfTorrents, { recursive: true });
      }
      if (fs.existsSync(TORRENTS_JSON_PATH)) {
        saved = JSON.parse(fs.readFileSync(TORRENTS_JSON_PATH, 'utf8'));
      }
      if (!saved.includes(magnet)) {
        saved.push(magnet);
        fs.writeFileSync(TORRENTS_JSON_PATH, JSON.stringify(saved), 'utf8');
      }
    } catch (err) {
      console.error('Failed to save magnet to json list:', err);
    }
  }
}

function getCachedTorrentBuffer(infoHash: string): Buffer | null {
  try {
    const torrentFilePath = path.join(process.cwd(), '.torrents', `${infoHash.toLowerCase()}.torrent`);
    if (fs.existsSync(torrentFilePath)) {
      return fs.readFileSync(torrentFilePath);
    }
  } catch (err) {
    console.error('Failed to read cached torrent file:', err);
  }
  return null;
}

function saveTorrentFile(torrent: any) {
  try {
    if (!torrent || !torrent.infoHash || !torrent.torrentFile) return;
    const torrentsDir = path.join(process.cwd(), '.torrents');
    if (!fs.existsSync(torrentsDir)) {
      fs.mkdirSync(torrentsDir, { recursive: true });
    }
    const torrentFilePath = path.join(torrentsDir, `${torrent.infoHash.toLowerCase()}.torrent`);
    if (!fs.existsSync(torrentFilePath)) {
      fs.writeFileSync(torrentFilePath, torrent.torrentFile);
      console.log(`Saved torrent file meta-cache for persistent recovery: ${torrent.infoHash}.torrent`);
    }
  } catch (err) {
    console.error('Failed to save torrent file meta-cache:', err);
  }
}

function saveTorrentMetadataJson(torrent: any, stats: any) {
  try {
    if (!torrent || !torrent.infoHash || !stats) return;
    const torrentsDir = path.join(process.cwd(), '.torrents');
    if (!fs.existsSync(torrentsDir)) {
      fs.mkdirSync(torrentsDir, { recursive: true });
    }
    const metaPath = path.join(torrentsDir, `${torrent.infoHash.toLowerCase()}.json`);
    if (stats.ready) {
      fs.writeFileSync(metaPath, JSON.stringify(stats, null, 2), 'utf8');
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
const CACHED_STATS_TTL_MS = 3000;

function getCachedTorrentStats(infoHash: string) {
  try {
    const key = infoHash.toLowerCase();
    const now = Date.now();
    const hit = cachedStatsCache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.stats;
    }
    const metaPath = path.join(process.cwd(), '.torrents', `${key}.json`);
    let stats = null;
    if (fs.existsSync(metaPath)) {
      stats = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
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

function checkFileOnDisk(torrentName: string, filePath: string, expectedLength: number): { exists: boolean; progress: number } {
  try {
    const torrentsDir = path.join(process.cwd(), '.torrents');
    
    // Possibility 1: direct filename in torrentsDir
    const baseName = path.basename(filePath);
    let absPath = path.join(torrentsDir, baseName);
    if (fs.existsSync(absPath)) {
      const s = fs.statSync(absPath);
      if (s.size >= expectedLength) {
        return { exists: true, progress: 1 };
      }
      return { exists: true, progress: Math.min(s.size / expectedLength, 0.99) };
    }

    // Possibility 2: subdirectory
    absPath = path.join(torrentsDir, filePath);
    if (fs.existsSync(absPath)) {
      const s = fs.statSync(absPath);
      if (s.size >= expectedLength) {
        return { exists: true, progress: 1 };
      }
      return { exists: true, progress: Math.min(s.size / expectedLength, 0.99) };
    }

    // Possibility 3: torrentName/filePath
    if (torrentName) {
      absPath = path.join(torrentsDir, torrentName, filePath);
      if (fs.existsSync(absPath)) {
        const s = fs.statSync(absPath);
        if (s.size >= expectedLength) {
          return { exists: true, progress: 1 };
        }
        return { exists: true, progress: Math.min(s.size / expectedLength, 0.99) };
      }
    }
  } catch (err) {
    // ignore
  }
  return { exists: false, progress: 0 };
}

function loadSavedMagnets() {
  try {
    const torrentsDir = path.join(process.cwd(), '.torrents');
    if (!fs.existsSync(torrentsDir)) {
      fs.mkdirSync(torrentsDir, { recursive: true });
    }

    // 1. Scan and restore full *.torrent files (loaded with complete metadata instantly without DHT!)
    const files = fs.readdirSync(torrentsDir);
    let restoredCaches = 0;
    files.forEach(file => {
      if (file.toLowerCase().endsWith('.torrent')) {
        try {
          const infoHash = file.slice(0, -8).toLowerCase();
          const cached = getCachedTorrentStats(infoHash);
          if (cached && cached.done) {
            console.log(`Bypassing torrent restore for completed cache to save resources: ${file}`);
            return;
          }
          const torrentFilePath = path.join(torrentsDir, file);
          const torrentBuffer = fs.readFileSync(torrentFilePath);
          console.log(`Restoring persistent torrent meta-cache file: ${file}`);
          client.add(torrentBuffer, {
            path: torrentsDir,
            announce: PUBLIC_TRACKERS,
            strategy: 'rarest'
          });
          restoredCaches++;
        } catch (e) {
          console.error(`Failed to restore persistent torrent file ${file}:`, e);
        }
      }
    });

    // 2. Scan and restore raw magnet links
    if (fs.existsSync(TORRENTS_JSON_PATH)) {
      const saved: string[] = JSON.parse(fs.readFileSync(TORRENTS_JSON_PATH, 'utf8'));
      saved.forEach(magnet => {
        try {
          const trackerMagnet = addTrackersToMagnet(magnet);
          const infoHashMatch = trackerMagnet.match(/btih:([a-fA-F0-9]{40})/);
          const infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : '';
          
          if (infoHash) {
            const cached = getCachedTorrentStats(infoHash);
            if (cached && cached.done) {
              console.log(`Bypassing magnet restore for completed cache to save resources: ${infoHash}`);
              return;
            }
          }
          
          // Only add magnet if the full .torrent meta-cache file was not already loaded
          const hasCache = infoHash && fs.existsSync(path.join(torrentsDir, `${infoHash}.torrent`));
          if (!hasCache) {
            console.log('Restoring saved torrent magnet:', trackerMagnet.slice(0, 50));
            client.add(trackerMagnet, { 
              path: torrentsDir,
              strategy: 'rarest'
            });
          }
        } catch (e) {
          console.error('Failed to restore saved magnet:', e);
        }
      });
    }
  } catch (err) {
    console.error('Failed to load saved magnets:', err);
  }
}

async function startServer() {
  // Initialize and restore saved magnet links from previous sessions/dev server reboots
  loadSavedMagnets();

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
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Token');
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
        const cachedBuf = cachedBh ? getCachedTorrentBuffer(cachedBh) : null;
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
            strategy: 'rarest'
          });
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
      saveMagnet(magnet);

      if (torrent.ready) {
        saveTorrentFile(torrent);
        return res.json(getTorrentStats(torrent));
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
        const stats = getTorrentStats(torrent);
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
                return res.json(getTorrentStats(existing));
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
  app.get('/api/torrents', (req, res) => {
    try {
      if (!client || !client.torrents) {
        return res.json([]);
      }

      const liveStatsMap = new Map();
      client.torrents.forEach(t => {
        const stats = getTorrentStats(t);
        if (stats) {
          liveStatsMap.set(stats.infoHash.toLowerCase(), stats);
        }
      });

      const torrentsDir = path.join(process.cwd(), '.torrents');
      const allStats: any[] = [];
      
      if (fs.existsSync(torrentsDir)) {
        const files = fs.readdirSync(torrentsDir);
        files.forEach(file => {
          if (file.toLowerCase().endsWith('.json') && file.toLowerCase() !== 'torrents.json') {
            const h = file.slice(0, -5).toLowerCase();
            const live = liveStatsMap.get(h);
            if (live) {
              if (live.ready) {
                // Metadata JSON is persisted by getTorrentStats via a throttled
                // writer; writing it again here on every poll would add needless
                // synchronous fs I/O to the event loop.
                allStats.push(live);
              } else {
                const cached = getCachedTorrentStats(h);
                if (cached && cached.ready) {
                  allStats.push({
                    ...cached,
                    numPeers: live.numPeers,
                    downloadSpeed: live.downloadSpeed,
                    uploadSpeed: live.uploadSpeed,
                  });
                } else {
                  allStats.push(live);
                }
              }
              liveStatsMap.delete(h);
            } else {
              const cached = getCachedTorrentStats(h);
              if (cached) {
                allStats.push({
                  ...cached,
                  numPeers: 0,
                  downloadSpeed: 0,
                  uploadSpeed: 0,
                });
              }
            }
          }
        });
      }

      liveStatsMap.forEach(live => {
        allStats.push(live);
      });

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
            if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
            const torrentFilePath = path.join(torrentsDir, `${h}.torrent`);
            if (fs.existsSync(torrentFilePath)) fs.unlinkSync(torrentFilePath);
            // Delete any partially/fully downloaded data files listed in the
            // cached metadata so a "remove" frees disk space like live removes.
            try {
              const cached = getCachedTorrentStats(h);
              if (cached && cached.files && Array.isArray(cached.files)) {
                cached.files.forEach((f: any) => {
                  const name = f.name || f.path || '';
                  if (!name) return;
                  const base = path.basename(name);
                  const candidates = [path.join(torrentsDir, base), path.join(torrentsDir, name)];
                  candidates.forEach((p) => {
                    try {
                      if (fs.existsSync(p)) {
                        fs.unlinkSync(p);
                        console.log(`Removed cached data file: ${base}`);
                      }
                    } catch (e) {}
                  });
                });
              }
            } catch (e) {
              // non-fatal
            }
            if (fs.existsSync(TORRENTS_JSON_PATH)) {
              const saved = JSON.parse(fs.readFileSync(TORRENTS_JSON_PATH, 'utf8')) as string[];
              fs.writeFileSync(TORRENTS_JSON_PATH, JSON.stringify(saved.filter((m) => !m.includes(h)), null, 2), 'utf8');
            }
          } catch (err) {
            console.error('Failed to clean cached-only torrent on remove:', err);
          }
          console.log(`Removed cached-only torrent ${h}`);
          return res.json({ infoHash: h, removed: true, cachedOnly: true });
        }

        if (action === 'resume') {
          // Torrent is no longer in the client (e.g. cleared from memory but its
          // .torrent meta-cache survived). Re-add it instantly so the download
          // resumes without waiting on a cold DHT/metadata bootstrap.
          const torrentBuffer = getCachedTorrentBuffer(h);
          if (torrentBuffer) {
            console.log(`Resuming cached-only torrent ${h} from torrent meta-cache`);
            torrent = await client.add(torrentBuffer, { path: torrentsDir, announce: PUBLIC_TRACKERS, strategy: 'rarest' });
          } else if (fs.existsSync(TORRENTS_JSON_PATH)) {
            const saved = JSON.parse(fs.readFileSync(TORRENTS_JSON_PATH, 'utf8')) as string[];
            const magnet = saved.find((m) => m.toLowerCase().includes(h));
            if (magnet) {
              console.log(`Resuming cached-only torrent ${h} from saved magnet`);
              torrent = await client.add(addTrackersToMagnet(magnet), { path: torrentsDir, strategy: 'rarest' });
            }
          }
          if (!torrent) {
            const cached = getCachedTorrentStats(h);
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
            try {
              const dir = path.join(process.cwd(), '.torrents');
              ['torrents.json'].forEach((f) => {
                const p = path.join(dir, f);
                if (fs.existsSync(p)) {
                  const saved = JSON.parse(fs.readFileSync(p, 'utf8')) as string[];
                  fs.writeFileSync(p, JSON.stringify(saved.filter((m) => !m.includes(h)), null, 2), 'utf8');
                }
              });
              const metaPath = path.join(dir, `${h}.json`);
              if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
              const torrentFilePath = path.join(dir, `${h}.torrent`);
              if (fs.existsSync(torrentFilePath)) fs.unlinkSync(torrentFilePath);
            } catch (err) {
              console.error('Failed to clean meta cache on remove:', err);
            }
            console.log(`Removed torrent ${h} (${name})`);
          });
          return res.json({ infoHash: h, removed: true });
        }
        default:
          return res.status(400).json({ error: `Unsupported action: ${action}` });
      }

      const stats = getTorrentStats(torrent);
      return res.json(stats);
    } catch (err: any) {
      console.error('Torrent action error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to perform action on torrent' });
      }
    }
  });

  // API to remove all active torrents and clean cached files from disk
  app.post('/api/torrents/cleanup', (req, res) => {
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
      if (fs.existsSync(torrentsDir)) {
        const files = fs.readdirSync(torrentsDir);
        files.forEach(file => {
          if (file.toLowerCase().endsWith('.json') && file.toLowerCase() !== 'torrents.json') {
            const p = path.join(torrentsDir, file);
            const h = file.slice(0, -5).toLowerCase();
            const metaPath = path.join(torrentsDir, `${h}.torrent`);
            // Leave torrents that still have a .torrent meta cache on the
            // saved-magnets list so they can be re-added instantly later.
            if (!fs.existsSync(metaPath)) {
              fs.unlinkSync(p);
            }
          }
        });
      }

      res.json({ deleted: removed });
    } catch (err) {
      console.error('Torrent cleanup error:', err);
      res.status(500).json({ error: 'Failed to clean torrent caches' });
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
        const cached = getCachedTorrentStats(h);
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

      if (!fs.existsSync(absPath)) {
        absPath = path.join(process.cwd(), '.torrents', fileName);
      }

      if (!fs.existsSync(absPath)) {
        console.error('File does not exist on disk at path:', absPath);
        return res.status(404).send(`File not found on disk: ${fileName}`);
      }

      const diskStats = fs.statSync(absPath);
      const isCompleteOnDisk = diskStats.size >= fileLength;

      // Ensure that we only allow downloading if the file is fully ready on disk.
      // This protects against browser proxy dropouts on incomplete content.
      if (!isCompleteOnDisk) {
        return res.status(400).send('File is still transferring to the server. Please wait until progress is 100% in the UI, then click save.');
      }

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
        const end = (parts[1] && parts[1].trim() !== '') ? parseInt(parts[1], 10) : fileLength - 1;
        
        if (start >= fileLength || end >= fileLength || start > end) {
          res.setHeader('Content-Range', `bytes */${fileLength}`);
          return res.status(416).send('Requested Range Not Satisfiable');
        }

        const chunksize = (end - start) + 1;
        
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileLength}`);
        res.setHeader('Content-Length', chunksize);
        
        const rstream = fs.createReadStream(absPath, { start, end });
        rstream.pipe(res);
        rstream.on('error', (err: any) => {
          console.error('Range Stream Error:', err);
          if (!res.headersSent) res.status(500).end();
        });
      } else {
        // Remove Content-Length to force Chunked Transfer Encoding.
        // Extremely important to bypass Google Frontend (GFE) 32MB single buffered response size limit on Cloud Run!
        res.removeHeader('Content-Length');
        
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

  // Vite middleware for development
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

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
  });
}

function getTorrentStats(t: WebTorrent.Torrent) {
  try {
    if (!t) return null;
    const isReady = t.ready && !(t as any).destroyed;
    const infoHash = (t.infoHash || '').toLowerCase();

    // Base fallback from cache if we have one
    const cached = getCachedTorrentStats(infoHash);
    
    // Compile basic metadata
    const name = t.name || (cached ? cached.name : 'Fetching metadata...');
    const files = t.files || (cached ? cached.files : []);
    const totalLength = t.length || (cached ? cached.length : 0);

    // Compute progress by checking each file on disk
    let totalDownloaded = 0;
    const processedFiles = files.map((f: any, i: number) => {
      if (!f) return null;
      const cachedFile = (cached && cached.files) ? cached.files.find((cf: any) => cf.index === i) : null;
      const sizeExpected = f.length || (cachedFile ? cachedFile.length : 0);
      const filePath = f.path || f.name || (cachedFile ? (cachedFile.path || cachedFile.name) : '');
      const fileName = f.name || (cachedFile ? cachedFile.name : 'Unknown');

      // Live torrents track progress/downloaded in memory, which is both
      // non-blocking and accurate. Only fall back to the disk check (with a
      // TTL cache) for torrents restored from metadata caches.
      let progress = 0;
      let downloaded = 0;

      const memProgress = typeof f.progress === 'number' && f.progress > 0 ? f.progress : 0;
      if (memProgress > 0) {
        progress = memProgress;
        downloaded = Math.floor(memProgress * sizeExpected);
      } else {
        const disk = checkFileOnDiskCached(t.name || (cached ? cached.name : ''), filePath, sizeExpected);
        if (disk.exists) {
          progress = disk.progress;
          downloaded = Math.floor(disk.progress * sizeExpected);
        } else {
          const memDownloaded = typeof f.downloaded === 'number' && f.downloaded > 0 ? f.downloaded : 0;
          progress = memDownloaded > 0 ? (sizeExpected > 0 ? Math.min(memDownloaded / sizeExpected, 1) : 0) : 0;
          downloaded = memDownloaded;
        }
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
    }).filter(Boolean);

    const overallProgress = totalLength > 0 ? (totalDownloaded / totalLength) : t.progress;
    const isDone = overallProgress >= 1.0 || t.done;

    // Measure real throughput from the delta of bytes actually downloaded
    // between polls (matches the speed the user is really getting), falling
    // back to WebTorrent's own speedometer for the very first sample.
    const measured = measureTorrentSpeed(
      infoHash,
      isDone ? totalDownloaded : (t.downloaded || totalDownloaded),
      isDone ? (t.uploaded || 0) : (t.uploaded || 0),
      isDone ? 0 : (t.downloadSpeed || 0),
      isDone ? 0 : (t.uploadSpeed || 0)
    );

    const stats = {
      infoHash: t.infoHash || '',
      name: name,
      paused: !!(t as any).paused,
      progress: overallProgress,
      downloadSpeed: measured.down,
      uploadSpeed: measured.up,
      numPeers: t.numPeers || 0,
      length: totalLength,
      downloaded: totalDownloaded,
      timeRemaining: isDone ? 0 : (typeof t.timeRemaining === 'number' && Number.isFinite(t.timeRemaining) ? t.timeRemaining : 0),
      done: isDone,
      ready: isReady || (processedFiles.length > 0),
      files: processedFiles
    };

    // If the torrent just achieved ready status in memory, cache its metadata json
    if (isReady && t.files && t.files.length > 0 && shouldWriteMeta(infoHash, stats)) {
      saveTorrentMetadataJson(t, stats);
    }

    // Auto-destroy completed torrents to release TCP/UDP ports and prevent resource exhaustion
    if (isDone && !(t as any)._handlingDone && isReady) {
      (t as any)._handlingDone = true;
      saveTorrentMetadataJson(t, stats);
      saveTorrentFile(t);
      setTimeout(() => {
        try {
          console.log(`Resource Optimization: Auto-destroying completed seeding session for ${t.infoHash}`);
          t.destroy();
        } catch (e) {
          // ignore
        }
      }, 1000);
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
