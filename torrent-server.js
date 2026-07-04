#!/usr/bin/env node
/**
 * Upgraded Torrent Streaming Server
 * Integrates streamtor server architecture
 * Exposes /api/torrents and provides complete range-based HTTP streaming of cached files
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import WebTorrent from 'webtorrent';
import parseTorrent from 'parse-torrent';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.TORRENT_SERVER_PORT || 3002;
const TORRENTS_DIR = path.join(__dirname, '.torrents');
const TORRENTS_JSON_PATH = path.join(TORRENTS_DIR, 'torrents.json');

// Ensure storage directories exist
if (!fs.existsSync(TORRENTS_DIR)) {
  fs.mkdirSync(TORRENTS_DIR, { recursive: true });
}

const client = new WebTorrent({
  maxConns: 2000,
  dht: true,
  lsd: true,
  utp: true,
  utPex: true,
  natUpnp: true,
  natPmp: true,
  webSeeds: true,
  downloadLimit: -1,
  uploadLimit: -1 // CRITICAL: Unlimited upload — BitTorrent uses tit-for-tat; throttling upload directly kills download speed
});

// Track removed torrents so GET /api/torrents never resurrects them
const removedHashes = new Set();

// In-memory stats cache to avoid blocking I/O on every poll
const statsMemCache = new Map();
const lastDiskWrite = new Map();
const lastDiskCheck = new Map();

// Log global download activity for diagnostics
client.on('torrent', (torrent) => {
  console.log(`[WebTorrent] Torrent ready: ${torrent.name} | Peers: ${torrent.numPeers} | Size: ${(torrent.length / 1024 / 1024).toFixed(1)} MB`);
  // Force-select ALL files for immediate download at HIGH priority
  if (torrent.files && torrent.files.length > 0) {
    torrent.files.forEach(file => {
      try { file.select(5); } catch (e) { /* ignore */ }
    });
  }
  // Minimal logging to avoid event loop overhead — log speed in Mbps for diagnostics
  torrent.on('download', () => {
    const now = Date.now();
    if (!torrent._lastLog || now - torrent._lastLog > 15000) {
      torrent._lastLog = now;
      const speedMbps = (torrent.downloadSpeed * 8 / 1000 / 1000).toFixed(2);
      console.log(`[DL] ${(torrent.progress * 100).toFixed(1)}% | ${speedMbps} Mbps | Peers: ${torrent.numPeers}`);
    }
  });
  // AGGRESSIVE peer discovery: re-announce every 10s for the first 2 minutes, then every 60s
  const torrentStartTime = Date.now();
  const reannounceInterval = setInterval(() => {
    if (torrent.destroyed) { clearInterval(reannounceInterval); return; }
    if (torrent.done) { clearInterval(reannounceInterval); return; }
    try {
      if (torrent.discovery && torrent.discovery.tracker) {
        torrent.discovery.tracker.update();
      }
    } catch (e) { /* ignore */ }
    // After 2 minutes, slow down re-announce to every 60s
    const elapsed = Date.now() - torrentStartTime;
    if (elapsed > 120000) {
      clearInterval(reannounceInterval);
      const slowInterval = setInterval(() => {
        if (torrent.destroyed || torrent.done) { clearInterval(slowInterval); return; }
        try {
          if (torrent.discovery && torrent.discovery.tracker) {
            torrent.discovery.tracker.update();
          }
        } catch (e) { /* ignore */ }
      }, 60000);
    }
  }, 10000);
});

client.on('error', (err) => {
  console.error('Global WebTorrent error:', err);
});

const PUBLIC_TRACKERS = [
  // Top-tier, most reliable public trackers
  'udp://tracker.opentrackr.org:1337/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bitalt.org:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://tracker1.bt.moack.co.kr:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.publictracker.xyz:6969/announce',
  'udp://tracker.opentorrent.top:6969/announce',
  'udp://tracker.plx.im:6969/announce',
  'udp://tracker.fnix.net:6969/announce',
  'udp://tracker.auctor.tv:6969/announce',
  'udp://tracker.t-1.org:6969/announce',
  'udp://tracker.ducks.party:1984/announce',
  'udp://zer0day.ch:1337/announce',
  'udp://udp.tracker.projectk.org:23333/announce',
  'udp://tracker.tryhackx.org:6969/announce',
  'udp://tracker.startwork.cv:1337/announce',
  'udp://tracker.nyaa.vc:6969/announce',
  'udp://tracker.iperson.xyz:6969/announce',
  'udp://tracker.gmi.gd:6969/announce',
  'udp://tracker.bluefrog.pw:2710/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://uabits.today:6990/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://movies.zsw.ca:6969/announce',
  'udp://ipv4.tracker.harry.lu:80/announce',
  'http://tracker.bt4g.com:2095/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://9.rarbg.to:2710/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://tracker.internetwarriors.net:1337/announce'
];

function addTrackersToMagnet(magnet) {
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

function saveMagnet(magnet) {
  if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
    try {
      let saved = [];
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

function saveTorrentFile(torrent) {
  try {
    if (!torrent || !torrent.infoHash || !torrent.torrentFile) return;
    const torrentFilePath = path.join(TORRENTS_DIR, `${torrent.infoHash.toLowerCase()}.torrent`);
    if (!fs.existsSync(torrentFilePath)) {
      fs.writeFileSync(torrentFilePath, torrent.torrentFile);
      console.log(`Saved torrent file meta-cache for persistent recovery: ${torrent.infoHash}.torrent`);
    }
  } catch (err) {
    console.error('Failed to save torrent file meta-cache:', err);
  }
}

function saveTorrentMetadataJson(torrent, stats) {
  try {
    if (!torrent || !torrent.infoHash || !stats) return;
    const h = torrent.infoHash.toLowerCase();
    // Always update in-memory cache instantly (free)
    statsMemCache.set(h, stats);
    // Throttle disk writes to at most once per 10 seconds per torrent
    const now = Date.now();
    const lastWrite = lastDiskWrite.get(h) || 0;
    if (now - lastWrite < 10000) return; // Skip disk write if written recently
    lastDiskWrite.set(h, now);
    const metaPath = path.join(TORRENTS_DIR, `${h}.json`);
    if (stats.ready) {
      fs.writeFile(metaPath, JSON.stringify(stats, null, 2), 'utf8', (err) => {
        if (err) console.error('Async metadata write failed:', err.message);
      });
    }
  } catch (err) {
    console.error('Failed to save torrent metadata JSON cache:', err);
  }
}

function getCachedTorrentStats(infoHash) {
  const h = infoHash.toLowerCase();
  // Check in-memory cache first (instant, no I/O)
  if (statsMemCache.has(h)) {
    return statsMemCache.get(h);
  }
  // Fall back to disk
  try {
    const metaPath = path.join(TORRENTS_DIR, `${h}.json`);
    if (fs.existsSync(metaPath)) {
      const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      statsMemCache.set(h, data); // Cache for next time
      return data;
    }
  } catch (err) {
    console.error('Failed to read cached torrent metadata JSON:', err);
  }
  return null;
}

// Utility to forcefully delete a file on Windows by retrying if it's locked (EBUSY)
function forceDeleteFile(filePath, retries = 5, delay = 1000) {
  if (!fs.existsSync(filePath)) return;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    console.log(`[Remove] Successfully deleted: ${filePath}`);
  } catch (err) {
    if (retries > 0) {
      console.log(`[Remove] File locked, retrying in ${delay}ms... (${retries} left): ${path.basename(filePath)}`);
      setTimeout(() => forceDeleteFile(filePath, retries - 1, delay), delay);
    } else {
      console.error(`[Remove] FAILED to delete after retries: ${path.basename(filePath)}`, err.message);
    }
  }
}

// Delete physical media files for a torrent using cached metadata
function deletePhysicalFiles(cached, infoHash) {
  console.log(`[Remove] deletePhysicalFiles called for ${infoHash}`);
  if (cached && cached.files) {
    cached.files.forEach(f => {
      const absPath = path.join(TORRENTS_DIR, f.path || f.name);
      forceDeleteFile(absPath);
      const baseAbsPath = path.join(TORRENTS_DIR, f.name);
      if (absPath !== baseAbsPath) {
        forceDeleteFile(baseAbsPath);
      }
    });
    if (cached.name) {
      const dirPath = path.join(TORRENTS_DIR, cached.name);
      forceDeleteFile(dirPath);
    }
  }
  // Also scan .torrents directory for any files that look like they belong to this torrent
  // This catches edge cases where file paths don't match cached metadata
  try {
    const allFiles = fs.readdirSync(TORRENTS_DIR);
    allFiles.forEach(file => {
      // Skip metadata files
      if (file.endsWith('.json') || file.endsWith('.torrent') || file === 'torrents.json') return;
      // Check if this file/folder matches the torrent name
      if (cached && cached.name && file === cached.name) {
        forceDeleteFile(path.join(TORRENTS_DIR, file));
      }
    });
  } catch (e) {
    console.error('[Remove] Error scanning directory:', e.message);
  }
  console.log(`[Remove] deletePhysicalFiles completed for ${infoHash}`);
}

function checkFileOnDisk(torrentName, filePath, expectedLength) {
  try {
    // Possibility 1: direct filename in TORRENTS_DIR
    const baseName = path.basename(filePath);
    let absPath = path.join(TORRENTS_DIR, baseName);
    if (fs.existsSync(absPath)) {
      const s = fs.statSync(absPath);
      if (s.size >= expectedLength) {
        return { exists: true, progress: 1 };
      }
      return { exists: true, progress: Math.min(s.size / expectedLength, 0.99) };
    }

    // Possibility 2: subdirectory
    absPath = path.join(TORRENTS_DIR, filePath);
    if (fs.existsSync(absPath)) {
      const s = fs.statSync(absPath);
      if (s.size >= expectedLength) {
        return { exists: true, progress: 1 };
      }
      return { exists: true, progress: Math.min(s.size / expectedLength, 0.99) };
    }

    // Possibility 3: torrentName/filePath
    if (torrentName) {
      absPath = path.join(TORRENTS_DIR, torrentName, filePath);
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
    // 1. Scan and restore full *.torrent files (loaded instantly with complete metadata)
    const files = fs.readdirSync(TORRENTS_DIR);
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
          const torrentFilePath = path.join(TORRENTS_DIR, file);
          const torrentBuffer = fs.readFileSync(torrentFilePath);
          console.log(`Restoring persistent torrent meta-cache file: ${file}`);
          client.add(torrentBuffer, {
            path: TORRENTS_DIR,
            announce: PUBLIC_TRACKERS,
            maxConns: 500,
            maxWebConns: 200
          });
          restoredCaches++;
        } catch (e) {
          console.error(`Failed to restore persistent torrent file ${file}:`, e);
        }
      }
    });

    // 2. Scan and restore raw magnet links
    if (fs.existsSync(TORRENTS_JSON_PATH)) {
      const saved = JSON.parse(fs.readFileSync(TORRENTS_JSON_PATH, 'utf8'));
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
          const hasCache = infoHash && fs.existsSync(path.join(TORRENTS_DIR, `${infoHash}.torrent`));
          if (!hasCache) {
            console.log('Restoring saved torrent magnet:', trackerMagnet.slice(0, 50));
            client.add(trackerMagnet, { 
              path: TORRENTS_DIR,
              announce: PUBLIC_TRACKERS,
              maxConns: 500,
              maxWebConns: 200
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

function getTorrentStats(t) {
  try {
    if (!t) return null;
    const isReady = t.ready && !t.destroyed;
    const infoHash = (t.infoHash || '').toLowerCase();

    // Base fallback from cache if we have one
    const cached = getCachedTorrentStats(infoHash);
    
    // Compile basic metadata
    const name = t.name || (cached ? cached.name : 'Fetching metadata...');
    const files = t.files || (cached ? cached.files : []);
    const totalLength = t.length || (cached ? cached.length : 0);

    // Compute progress — prefer WebTorrent's live in-memory stats over disk checks
    let totalDownloaded = 0;
    // Only check disk every 5 seconds to avoid blocking the event loop
    const now = Date.now();
    const lastCheck = lastDiskCheck.get(infoHash) || 0;
    const shouldCheckDisk = (now - lastCheck) > 5000;
    if (shouldCheckDisk) lastDiskCheck.set(infoHash, now);

    const processedFiles = files.map((f, i) => {
      if (!f) return null;
      const cachedFile = (cached && cached.files) ? cached.files.find(cf => cf.index === i) : null;
      const sizeExpected = f.length || (cachedFile ? cachedFile.length : 0);
      const filePath = f.path || f.name || (cachedFile ? (cachedFile.path || cachedFile.name) : '');
      const fileName = f.name || (cachedFile ? cachedFile.name : 'Unknown');

      let progress = 0;
      let downloaded = 0;

      // Use WebTorrent's live data first (accurate during active downloads)
      if (f.progress !== undefined && f.progress > 0) {
        progress = f.progress;
        downloaded = f.downloaded || Math.floor(f.progress * sizeExpected);
      } else if (shouldCheckDisk) {
        // Fall back to disk check for cached/completed torrents (throttled)
        const disk = checkFileOnDisk(t.name || (cached ? cached.name : ''), filePath, sizeExpected);
        if (disk.exists) {
          progress = disk.progress;
          downloaded = Math.floor(disk.progress * sizeExpected);
        }
      } else if (cachedFile) {
        // Use cached values between disk checks
        progress = cachedFile.progress || 0;
        downloaded = cachedFile.downloaded || 0;
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

    // Use WebTorrent's progress as the primary source, with downloaded bytes as fallback
    const wtProgress = t.progress || 0;
    const computedProgress = totalLength > 0 ? (totalDownloaded / totalLength) : 0;
    const overallProgress = Math.max(wtProgress, computedProgress);
    const isDone = overallProgress >= 1.0 || t.done;

    const stats = {
      infoHash: t.infoHash || '',
      name: name,
      progress: overallProgress,
      downloadSpeed: isDone ? 0 : t.downloadSpeed,
      uploadSpeed: isDone ? 0 : t.uploadSpeed,
      numPeers: t.numPeers || 0,
      length: totalLength,
      downloaded: totalDownloaded,
      timeRemaining: isDone ? 0 : (t.timeRemaining || 0),
      done: isDone,
      ready: isReady || (processedFiles.length > 0),
      files: processedFiles,
      paused: t ? !!t.paused : false
    };

    // If the torrent just achieved ready status in memory, cache its metadata json
    if (isReady && t.files && t.files.length > 0) {
      saveTorrentMetadataJson(t, stats);
    }

    // Save metadata for completed torrents but DON'T destroy them.
    // Seeding back to the swarm improves overall download speeds via tit-for-tat reciprocity.
    if (isDone && !t._handlingDone && isReady) {
      t._handlingDone = true;
      saveTorrentMetadataJson(t, stats);
      saveTorrentFile(t);
      console.log(`Torrent complete, continuing to seed: ${(t.infoHash || '').toLowerCase()}`);
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
      files: [],
      paused: false
    };
  }
}

// REST & Streaming Backend Server Start
async function startServer() {
  loadSavedMagnets();

  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // CORS Preflight
  app.options('*', (req, res) => {
    res.sendStatus(200);
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // REST API: Add torrent
  app.post('/api/torrents', async (req, res) => {
    const { magnet } = req.body;
    if (!magnet) {
      return res.status(400).json({ error: 'Magnet link or Torrent data required' });
    }

    let torrentId = magnet;
    if (typeof magnet === 'string' && magnet.startsWith('data:')) {
      try {
        const base64Data = magnet.split(',')[1];
        if (base64Data) {
          const buf = Buffer.from(base64Data, 'base64');
          try {
            const parsed = await parseTorrent(buf);
            if (parsed) {
              parsed.announce = (parsed.announce || []).concat(PUBLIC_TRACKERS);
              parsed.announce = [...new Set(parsed.announce)];
              torrentId = parsed;
            } else {
              torrentId = buf;
            }
          } catch (e) {
            console.error('Pre-parsing torrent failed, falling back to raw buffer:', e);
            torrentId = buf;
          }
        }
      } catch (err) {
        return res.status(400).json({ error: 'Invalid base64 torrent data' });
      }
    } else if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
      torrentId = addTrackersToMagnet(magnet);
    }

    try {
      let torrent = null;

      if (typeof magnet === 'string' && magnet.startsWith('magnet:')) {
        const infoHashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/);
        const h = infoHashMatch ? infoHashMatch[1].toLowerCase() : '';
        if (h) {
          torrent = client.get(h);
        }
      }

      if (!torrent) {
        try {
          torrent = client.add(torrentId, { 
            path: TORRENTS_DIR,
            announce: PUBLIC_TRACKERS,
            maxWebConns: 200,
            maxConns: 500
          });
        } catch (addErr) {
          if (addErr.message && addErr.message.toLowerCase().includes('duplicate')) {
            const match = addErr.message.match(/([a-fA-F0-9]{40})/);
            const h = match ? match[1].toLowerCase() : '';
            if (h) {
              torrent = client.get(h);
            }
          }
          if (!torrent) throw addErr;
        }
      }

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
      
      torrent.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: err.message || err.toString() });
        }
      });

    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to process torrent' });
      }
    }
  });

  // REST API: Cleanup orphaned files
  app.post('/api/torrents/cleanup', (req, res) => {
    try {
      if (!fs.existsSync(TORRENTS_DIR)) return res.json({ success: true, deleted: 0 });
      let deletedCount = 0;
      const validPaths = new Set();
      
      // Get all valid files from active torrents
      if (client && client.torrents) {
        client.torrents.forEach(t => {
          if (t.files) t.files.forEach(f => {
            const rootName = (f.path || f.name).split(/[\/\\]/)[0];
            validPaths.add(rootName);
          });
          if (t.name) validPaths.add(t.name);
        });
      }

      // Get all valid files from cached json
      const files = fs.readdirSync(TORRENTS_DIR);
      files.forEach(file => {
        if (file.endsWith('.json') && file !== 'torrents.json') {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(TORRENTS_DIR, file), 'utf8'));
            if (data && data.files) {
              data.files.forEach(f => {
                const rootName = (f.path || f.name).split(/[\/\\]/)[0];
                validPaths.add(rootName);
              });
            }
            if (data && data.name) validPaths.add(data.name);
          } catch(e){}
        }
      });

      // Scan and delete anything not in validPaths
      files.forEach(file => {
        if (file === 'torrents.json' || file.endsWith('.json') || file.endsWith('.torrent')) return;
        
        // This is a media file or folder
        if (!validPaths.has(file)) {
          const absPath = path.join(TORRENTS_DIR, file);
          try {
            const stat = fs.statSync(absPath);
            if (stat.isDirectory()) {
              fs.rmSync(absPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(absPath);
            }
            deletedCount++;
            console.log(`[Cleanup] Deleted orphaned item: ${file}`);
          } catch(e) {
            console.error(`[Cleanup] Failed to delete orphaned item ${file}:`, e);
          }
        }
      });

      res.json({ success: true, deleted: deletedCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: Torrent Actions (pause, resume, remove)
  app.post('/api/torrents/:infoHash/action', async (req, res) => {
    try {
      const { infoHash } = req.params;
      const { action } = req.body;
      const h = infoHash.toLowerCase();

      if (action === 'remove') {
        console.log(`[Remove] ===== REMOVE REQUEST for ${h} =====`);
        
        // 1. Immediately blacklist this hash so GET /api/torrents never returns it
        removedHashes.add(h);
        
        // 2. Read cached stats BEFORE we delete anything
        const cached = getCachedTorrentStats(h);
        console.log(`[Remove] Cached metadata: ${cached ? 'found' : 'NOT found'}`);
        if (cached && cached.files) {
          console.log(`[Remove] Files to delete: ${cached.files.map(f => f.name).join(', ')}`);
        }
        
        // 3. Wipe ALL cache/metadata files immediately
        // Delete .json
        const jsonPath = path.join(TORRENTS_DIR, `${h}.json`);
        try { if (fs.existsSync(jsonPath)) { fs.unlinkSync(jsonPath); console.log(`[Remove] Deleted ${h}.json`); } } catch (e) { console.error('[Remove] .json delete error:', e.message); }
        // Delete .torrent 
        const torrentPath = path.join(TORRENTS_DIR, `${h}.torrent`);
        try { if (fs.existsSync(torrentPath)) { fs.unlinkSync(torrentPath); console.log(`[Remove] Deleted ${h}.torrent`); } } catch (e) { console.error('[Remove] .torrent delete error:', e.message); }
        // Clean from magnets list
        if (fs.existsSync(TORRENTS_JSON_PATH)) {
          try {
            let saved = JSON.parse(fs.readFileSync(TORRENTS_JSON_PATH, 'utf8'));
            saved = saved.filter(m => {
              const mHashMatch = m.match(/btih:([a-fA-F0-9]{40})/);
              const mHash = mHashMatch ? mHashMatch[1].toLowerCase() : '';
              return mHash !== h;
            });
            fs.writeFileSync(TORRENTS_JSON_PATH, JSON.stringify(saved), 'utf8');
            console.log(`[Remove] Cleaned magnet from torrents.json`);
          } catch (e) { console.error('[Remove] magnets cleanup error:', e.message); }
        }
        
        // 4. Remove from WebTorrent client (if still active and not already destroyed)
        let torrent = null;
        try { torrent = client.get(h); } catch (e) { torrent = null; }
        
        if (torrent && !torrent.destroyed) {
          console.log(`[Remove] Torrent is active in WebTorrent, removing with destroyStore...`);
          try {
            client.remove(h, { destroyStore: true }, (err) => {
              if (err) console.error('[Remove] client.remove error:', err.message);
              else console.log('[Remove] WebTorrent client.remove completed successfully');
              // After WebTorrent releases handles, force-delete physical files
              setTimeout(() => deletePhysicalFiles(cached, h), 2000);
            });
          } catch (e) {
            console.error('[Remove] client.remove threw:', e.message);
            // Still try to delete files
            setTimeout(() => deletePhysicalFiles(cached, h), 1000);
          }
        } else {
          // Torrent is either not in client, or already destroyed
          if (torrent && torrent.destroyed) {
            console.log(`[Remove] Torrent was already destroyed (zombie), cleaning up manually...`);
            // Try to remove the zombie from client's internal list
            try { client.remove(h); } catch (e) { /* ignore zombie removal errors */ }
          } else {
            console.log(`[Remove] Torrent NOT in WebTorrent client, deleting files directly...`);
          }
          deletePhysicalFiles(cached, h);
        }
        
        return res.json({ success: true, message: 'Removed' });
      }

      if (action === 'pause' || action === 'resume') {
        let torrent = client.get(h);
        if (torrent) {
          if (action === 'pause') {
            torrent.pause();
          } else {
            torrent.resume();
          }
          return res.json(getTorrentStats(torrent));
        } else {
          return res.status(404).json({ error: 'Torrent not active or already completed' });
        }
      }

      res.status(400).json({ error: 'Invalid action' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get all active torrents state
  app.get('/api/torrents', (req, res) => {
    try {
      if (!client || !client.torrents) {
        return res.json([]);
      }

      const liveStatsMap = new Map();
      client.torrents.forEach(t => {
        const h = (t.infoHash || '').toLowerCase();
        // Skip removed torrents
        if (removedHashes.has(h)) return;
        const stats = getTorrentStats(t);
        if (stats) {
          liveStatsMap.set(h, stats);
        }
      });

      const allStats = [];
      
      if (fs.existsSync(TORRENTS_DIR)) {
        const files = fs.readdirSync(TORRENTS_DIR);
        files.forEach(file => {
          if (file.toLowerCase().endsWith('.json') && file.toLowerCase() !== 'torrents.json') {
            const h = file.slice(0, -5).toLowerCase();
            // Skip removed torrents
            if (removedHashes.has(h)) return;
            const live = liveStatsMap.get(h);
            if (live) {
              if (live.ready) {
                // Don't write to disk here — saveTorrentMetadataJson handles it with throttling
                allStats.push(live);
              } else {
                const cached = getCachedTorrentStats(h);
                if (cached && cached.ready) {
                  allStats.push({
                    ...cached,
                    numPeers: live.numPeers,
                    downloadSpeed: live.downloadSpeed,
                    uploadSpeed: live.uploadSpeed,
                    paused: false
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
                  paused: false
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

  // REST API: Stream a specific file natively via HTTP streaming
  app.get('/api/torrents/:infoHash/files/:fileIndex', async (req, res) => {
    try {
      const { infoHash, fileIndex } = req.params;
      const h = infoHash.toLowerCase();
      
      let torrent = client.get(infoHash);
      let file = null;
      let torrentPath = TORRENTS_DIR;
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
        return res.status(404).send('Torrent metadata or file mapping not found.');
      }

      let absPath = '';
      if (filePath) {
        absPath = path.isAbsolute(filePath) ? filePath : path.join(torrentPath, filePath);
      } else {
        absPath = path.join(torrentPath, fileName);
      }

      if (!fs.existsSync(absPath)) {
        absPath = path.join(TORRENTS_DIR, fileName);
      }

      if (!fs.existsSync(absPath)) {
        return res.status(404).send(`File not found on disk: ${fileName}`);
      }

      const diskStats = fs.statSync(absPath);
      const isCompleteOnDisk = diskStats.size >= fileLength;

      if (!isCompleteOnDisk) {
        return res.status(400).send('File is still downloading to server. Please wait until progress is 100%.');
      }

      console.log('Serving completed file from server disk:', absPath);

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
        res.on('close', () => {
          if (!rstream.destroyed) rstream.destroy();
        });
      } else {
        res.removeHeader('Content-Length');
        const fileStream = fs.createReadStream(absPath);
        fileStream.pipe(res);
        res.on('close', () => {
          if (!fileStream.destroyed) fileStream.destroy();
        });
      }
    } catch (err) {
      console.error('Stream endpoint error:', err);
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error while streaming');
      }
    }
  });

  // Unified Backward Compatibility - handles legacy uploads from DocFlow converter
  // POST /torrent/upload -> mapped to adding torrent
  app.post('/torrent/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    // Legacy fallback usually posted standard form or files, let's keep it simple
    res.status(200).json({ fileId: 'streamtor', info: { name: 'StreamTor Server Running', files: [] } });
  });

  // GET /torrent/:fileId/download/:fileName -> maps to active file indexes
  app.get('/torrent/:fileId/download/:fileName', (req, res) => {
    // Searches by file name across cached files
    try {
      const files = fs.readdirSync(TORRENTS_DIR);
      const matched = files.find(f => f.includes(req.params.fileName));
      if (matched) {
        const absPath = path.join(TORRENTS_DIR, matched);
        res.setHeader('Content-Disposition', `attachment; filename="${matched}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(absPath).pipe(res);
      } else {
        res.status(404).send('File not found in server cache');
      }
    } catch (e) {
      res.status(500).send(e.message);
    }
  });

  // Vite middleware removed: Frontend is managed by a separate 'npm run dev' process in start-docflow.bat
  // If in production, you can still serve static files if needed:
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start app
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║   StreamTor Torrent Streaming Server   ║
║   Port: ${PORT}                                  ║
║   Status: Upgraded & Running ✓         ║
╚════════════════════════════════════════╝
    `);
  });
}

// Clean exit hook
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

// Prevent server crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[CRASH PREVENTED] Uncaught exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH PREVENTED] Unhandled promise rejection:', reason);
});

startServer().catch(console.error);
