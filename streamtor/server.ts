import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import WebTorrent from 'webtorrent';

const client = new WebTorrent({
  maxConns: 15,
  utp: false
} as any);

client.on('error', (err: any) => {
  console.error('Global WebTorrent error:', err);
});

const TORRENTS_JSON_PATH = path.join(process.cwd(), '.torrents', 'torrents.json');

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://explodie.org:6969/announce',
  'http://tracker.ipv6tracker.ru:80/announce'
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
      console.log(`Saved torrent metadata JSON cache for ${torrent.infoHash}`);
    }
  } catch (err) {
    console.error('Failed to save torrent metadata JSON cache:', err);
  }
}

function getCachedTorrentStats(infoHash: string) {
  try {
    const metaPath = path.join(process.cwd(), '.torrents', `${infoHash.toLowerCase()}.json`);
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read cached torrent metadata JSON:', err);
  }
  return null;
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
            path: torrentsDir
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
              path: torrentsDir
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
  const PORT = Number(process.env.PORT) || 3002;

  // Custom CORS/Preflight support
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // API to add a torrent and get its metadata
  app.post('/api/torrents', async (req, res) => {
    const { magnet } = req.body;
    if (!magnet) {
      return res.status(400).json({ error: 'Magnet link required' });
    }

    let torrentId: string | Buffer = magnet;
    if (typeof magnet === 'string' && magnet.startsWith('data:')) {
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
            path: path.join(process.cwd(), '.torrents')
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
        if (!res.headersSent) {
          res.json(getTorrentStats(torrent));
        }
      });
      
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
                const metaPath = path.join(torrentsDir, file);
                try {
                  fs.writeFileSync(metaPath, JSON.stringify(live, null, 2), 'utf8');
                } catch (e) {}
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

      if (!torrent) {
        return res.status(404).json({ error: `Torrent not found: ${infoHash}` });
      }

      switch (action) {
        case 'pause':
          torrent.pause();
          break;
        case 'resume':
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

      // Remove all meta caches (json + torrent files) except torrents.json list
      const torrentsDir = path.join(process.cwd(), '.torrents');
      if (fs.existsSync(torrentsDir)) {
        const files = fs.readdirSync(torrentsDir);
        files.forEach(file => {
          if (file.toLowerCase().endsWith('.json') && file.toLowerCase() !== 'torrents.json') {
            fs.unlinkSync(path.join(torrentsDir, file));
          }
          if (file.toLowerCase().endsWith('.torrent')) {
            fs.unlinkSync(path.join(torrentsDir, file));
          }
        });
        // Reset the saved magnet list
        const torrentsJson = path.join(torrentsDir, 'torrents.json');
        if (fs.existsSync(torrentsJson)) {
          fs.writeFileSync(torrentsJson, '[]', 'utf8');
        }
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
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

      const disk = checkFileOnDisk(t.name || (cached ? cached.name : ''), filePath, sizeExpected);
      let progress = 0;
      let downloaded = 0;

      if (disk.exists) {
        progress = disk.progress;
        downloaded = Math.floor(disk.progress * sizeExpected);
      } else {
        progress = f.progress || 0;
        downloaded = f.downloaded || 0;
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

    const stats = {
      infoHash: t.infoHash || '',
      name: name,
      paused: !!(t as any).paused,
      progress: overallProgress,
      downloadSpeed: isDone ? 0 : t.downloadSpeed,
      uploadSpeed: isDone ? 0 : t.uploadSpeed,
      numPeers: t.numPeers || 0,
      length: totalLength,
      downloaded: totalDownloaded,
      timeRemaining: isDone ? 0 : (t.timeRemaining || 0),
      done: isDone,
      ready: isReady || (processedFiles.length > 0),
      files: processedFiles
    };

    // If the torrent just achieved ready status in memory, cache its metadata json
    if (isReady && t.files && t.files.length > 0) {
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
