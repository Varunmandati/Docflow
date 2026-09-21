import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, 
  Upload, 
  HardDrive, 
  List, 
  Activity, 
  Users, 
  Clock, 
  PlayCircle, 
  CheckCircle2, 
  ArrowDown, 
  ArrowUp, 
  Link as LinkIcon, 
  UploadCloud, 
  DownloadCloud, 
  Play,
  Pause,
  Trash2,
  FileBox,
  FileVideo,
  FileText,
  AlertCircle,
  CheckSquare,
  Square
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
export interface TorrentStats {
  infoHash: string;
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  length: number;
  downloaded: number;
  timeRemaining: number;
  done: boolean;
  ready: boolean;
  files: { 
    index: number; 
    name: string; 
    length: number; 
    downloaded: number; 
    progress: number 
  }[];
  paused?: boolean;
}

const TORRENT_SERVER_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_TORRENT_SERVER_URL || '').replace(/\/$/, '');

// ── Helpers ────────────────────────────────────────────────────────────────
const formatBytes = (bytes: number, decimals = 2): string => {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const formatSpeed = (bps: number): string => {
  if (!bps || bps <= 0) return '0 B/s';
  // Convert bytes/s to bits/s for Mbps display
  const bitsPerSec = bps * 8;
  if (bitsPerSec >= 1000000) {
    // Show in Mbps when >= 1 Mbps
    return `${(bitsPerSec / 1000000).toFixed(2)} Mbps`;
  } else if (bitsPerSec >= 1000) {
    // Show in Kbps when >= 1 Kbps
    return `${(bitsPerSec / 1000).toFixed(1)} Kbps`;
  }
  return `${bitsPerSec.toFixed(0)} bps`;
};

const isVideoFile = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v'].includes(ext);
};

// ── Main Component ─────────────────────────────────────────────────────────
const TorrentConverterView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'torrents' | 'add'>('add');
  const [torrents, setTorrents] = useState<TorrentStats[]>([]);
  const [magnet, setMagnet] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [addStatus, setAddStatus] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [pendingCleanup, setPendingCleanup] = useState<null | 'all' | string>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, Set<number>>>({});

  const toggleFileSelection = (infoHash: string, fileIndex: number) => {
    setSelectedFiles(prev => {
      const current = new Set(prev[infoHash] || []);
      if (current.has(fileIndex)) {
        current.delete(fileIndex);
      } else {
        current.add(fileIndex);
      }
      return { ...prev, [infoHash]: current };
    });
  };

  const handleDownloadSelected = (torrent: TorrentStats) => {
    const selected = selectedFiles[torrent.infoHash];
    if (!selected || selected.size === 0) {
      setAddStatus('Info: Select files to download by clicking the checkboxes.');
      return;
    }
    selected.forEach(fileIndex => {
      const file = torrent.files.find(f => f.index === fileIndex);
      if (file && file.progress > 0) {
        window.open(`${TORRENT_SERVER_URL}/api/torrents/${encodeURIComponent(torrent.infoHash)}/files/${fileIndex}`, '_blank');
      }
    });
  };

  const handleTorrentAction = async (infoHash: string, action: 'pause' | 'resume' | 'remove') => {
    try {
      console.log(`[UI] Sending ${action} request for ${infoHash}...`);
      const res = await fetch(`${TORRENT_SERVER_URL}/api/torrents/${encodeURIComponent(infoHash)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      
      if (!res.ok) {
        const errText = await res.text();
        console.error(`[UI] Server responded ${res.status}: ${errText}`);
        setAddStatus(`Error: Failed to ${action} torrent. Server error: ${res.status}`);
        return;
      }
      
      const data = await res.json();
      console.log(`[UI] ${action} response:`, data);
      
      if (action === 'remove') {
        setTorrents(prev => prev.filter(t => t.infoHash !== infoHash));
      } else {
        setTorrents(prev => prev.map(t => t.infoHash === infoHash ? data : t));
      }
    } catch (err: any) {
      console.error(`[UI] ${action} failed:`, err);
      setAddStatus(`Error: Failed to ${action} torrent: ${err.message || 'Network error. Is the server running?'}`);
    }
  };

  const handleCleanup = async () => {
    try {
      setIsCleaning(true);
      // First remove all active torrents
      const removePromises = torrents.map(t =>
        fetch(`${TORRENT_SERVER_URL}/api/torrents/${encodeURIComponent(t.infoHash)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove' })
        }).catch(() => null)
      );
      await Promise.all(removePromises);
      setTorrents([]);

      // Then clean orphaned files from disk
      const res = await fetch(`${TORRENT_SERVER_URL}/api/torrents/cleanup`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAddStatus(`Success: Removed ${torrents.length} active download(s) and deleted ${data.deleted} cached file(s)/folder(s) from disk.`);
      } else {
        setAddStatus(`Error: Removed ${torrents.length} active download(s), but disk cleanup returned an error.`);
      }
    } catch (err) {
      setAddStatus('Error: Cleanup failed. Is the server running?');
    } finally {
      setIsCleaning(false);
    }
  };

  const handleCleanupClick = () => setPendingCleanup('all');

  const confirmPendingCleanup = () => {
    const target = pendingCleanup;
    setPendingCleanup(null);
    if (target === 'all') {
      handleCleanup();
    } else if (target) {
      handleTorrentAction(target, 'remove');
    }
  };

  const handlePauseResumeAll = async (action: 'pause' | 'resume') => {
    const actionableTorrents = torrents.filter(t => !t.done);
    if (actionableTorrents.length === 0) return;
    try {
      const promises = actionableTorrents.map(t =>
        fetch(`${TORRENT_SERVER_URL}/api/torrents/${encodeURIComponent(t.infoHash)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        }).then(res => res.ok ? res.json() : null).catch(() => null)
      );
      const results = await Promise.all(promises);
      setTorrents(prev => prev.map(t => {
        const updated = results.find((r: any) => r && r.infoHash === t.infoHash);
        return updated || t;
      }));
    } catch (err) {
      console.error(`Failed to ${action} all torrents:`, err);
    }
  };

  // Real-time backend stats polling (every 500ms, sequential — no AbortController)
  useEffect(() => {
    let active = true;

    const fetchStats = async () => {
      if (!active) return;
      try {
        const res = await fetch(`${TORRENT_SERVER_URL}/api/torrents`);
        if (res.ok && active) {
          const text = await res.text();
          if (text && text.length > 2 && active) {
            setTorrents(JSON.parse(text));
          }
        }
      } catch (err: any) {
        // Swallow — server may be restarting
      }
      if (active) setTimeout(fetchStats, 500);
    };

    fetchStats();
    return () => { active = false; };
  }, []);

  // ── Tab 1 Action: Add Torrent ─────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setMagnet('');
      setAddStatus('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith('.torrent')) {
      setFile(droppedFile);
      setMagnet('');
      setAddStatus('');
    } else {
      setAddStatus('Error: Please drop a valid .torrent file.');
    }
  };

  const startDownloadSession = async () => {
    if (!magnet && !file) return;

    try {
      setIsAdding(true);
      setAddStatus('Processing torrent data...');

      let magnetLink = magnet;

      if (file) {
        setAddStatus('Parsing torrent metadata...');
        magnetLink = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      const res = await fetch(`${TORRENT_SERVER_URL}/api/torrents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: magnetLink })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to initialize torrent on backend.');
      }

      setAddStatus('Success! Torrent added successfully.');
      setMagnet('');
      setFile(null);

      // Auto redirect to active lists after a small delay
      setTimeout(() => {
        setActiveTab('torrents');
        setAddStatus('');
      }, 800);

    } catch (err: any) {
      setAddStatus(`Error: ${err.message || 'Check if the backend server is running.'}`);
    } finally {
      setIsAdding(false);
    }
  };

  // ── Computed Stats for Header ─────────────────────────────────────────────
  const activeCount = torrents.filter(t => !t.done).length;
  const totalDownloaded = torrents.reduce((acc, t) => acc + (t.downloaded || 0), 0);
  const activePeers = torrents.reduce((acc, t) => acc + (t.numPeers || 0), 0);

  const allPaused = torrents.filter(t => !t.done).every(t => t.paused);
  const hasActiveTorrents = torrents.some(t => !t.done);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8 fade-in-only">
      
      {/* ── HEADER TITLE ── */}
      <header className="view-header flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="view-eyebrow">
            <span className="eyebrow-dot" />
            Peer-to-peer cache
          </div>
          <h1 className="display-md">Torrent Streaming</h1>
          <p className="body-sm mt-1">
            Stream torrents directly from magnet links or .torrent files.
          </p>
        </div>

        {/* Tab Navigator + Disk utilities */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCleanupClick}
            disabled={isCleaning}
            className="p-2.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--danger-color)] hover:bg-[var(--well)] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Remove all active downloads and clean cached files from disk"
            aria-label="Clean disk and downloads"
          >
            <Trash2 size={16} />
          </button>
          <div className="segmented-control">
          <button
            onClick={() => setActiveTab('add')}
            className={`flex items-center gap-2 ${activeTab === 'add' ? 'active' : ''}`}
          >
            <Upload size={14} />
            <span className="caption-text">ADD TORRENT</span>
          </button>
          <button
            onClick={() => setActiveTab('torrents')}
            className={`flex items-center gap-2 relative ${activeTab === 'torrents' ? 'active' : ''}`}
          >
            <List size={14} />
            <span className="caption-text">ACTIVE DOWNLOADS</span>
            {torrents.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-[var(--danger-color)] text-white caption-text w-4 h-4 rounded-full flex items-center justify-center font-bold" style={{ fontSize: '9px' }}>
                {torrents.length}
              </span>
            )}
          </button>
          </div>
        </div>
      </header>

      {/* ── GLOBAL REAL-TIME STATS BAR ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="panel-card p-4 rounded-2xl flex items-center gap-4">
          <div className="chip-icon text-[var(--primary-color)]">
            <Activity size={20} />
          </div>
          <div>
            <p className="caption-text text-[var(--text-tertiary)]">Active Downloads</p>
            <p className="body-lg font-bold text-[var(--text-primary)] mono-stat">{activeCount}</p>
          </div>
        </div>

        <div className="panel-card p-4 rounded-2xl flex items-center gap-4">
          <div className="chip-icon text-[var(--success-color)]">
            <DownloadCloud size={20} />
          </div>
          <div>
            <p className="caption-text text-[var(--text-tertiary)]">Total Downloaded</p>
            <p className="body-lg font-bold text-[var(--text-primary)] mono-stat">{formatBytes(totalDownloaded)}</p>
          </div>
        </div>

        <div className="panel-card p-4 rounded-2xl flex items-center gap-4">
          <div className="chip-icon text-[var(--success-color)]">
            <Users size={20} />
          </div>
          <div>
            <p className="caption-text text-[var(--text-tertiary)]">Active Peers</p>
            <p className="body-lg font-bold text-[var(--text-primary)]">{activePeers}</p>
          </div>
        </div>
      </div>

      {/* Status block */}
      {addStatus && (
        <div className={`caption-mono p-4 rounded-xl border break-all mb-6 ${
          addStatus.includes('Error') 
            ? 'status-error' 
            : addStatus.includes('Success') 
              ? 'status-success' 
              : 'status-info'
        }`}>
          {addStatus}
        </div>
      )}

      {/* ── TAB CONTENT: ADD TORRENT ── */}
      {activeTab === 'add' && (
        <div className="space-y-6 fade-in-only">
          <div className="grid md:grid-cols-2 gap-6">
            
            {/* Magnet link container */}
            <div className="bg-[var(--background-card)] border border-[var(--border-color)] p-6 rounded-xl elevation-3 flex flex-col justify-between h-full space-y-4">
              <div>
                <div className="flex items-center gap-3 text-[var(--primary-color)] font-medium mb-4">
                  <LinkIcon size={20} />
                  <h3 className="body-md" style={{ fontWeight: 600 }}>Paste Magnet Link</h3>
                </div>
                <p className="caption-text" style={{ color: 'var(--text-secondary)' }}>
                  Input any public tracker or P2P DHT magnet link to initiate a direct server caching stream.
                </p>
                <textarea
                  rows={4}
                  placeholder="magnet:?xt=urn:btih:..."
                  value={magnet}
                  onChange={(e) => {
                    setMagnet(e.target.value);
                    setFile(null);
                    setAddStatus('');
                  }}
                  className="w-full vercel-input mt-4 leading-relaxed"
                  style={{ fontFamily: 'var(--font-family-mono)', fontSize: '13px', height: 'auto' }}
                />
              </div>
              <button
                onClick={startDownloadSession}
                disabled={(!magnet && !file) || isAdding}
                className="w-full glowing-btn pill-btn mt-4 px-6 py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontWeight: 600 }}
              >
                <Play size={16} />
                <span className="body-sm" style={{ fontWeight: 600 }}>{isAdding ? 'Initializing...' : 'START SESSION'}</span>
              </button>
            </div>

            {/* Dropzone container */}
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer flex flex-col items-center justify-center transition-all h-full min-h-[260px] ${
                file 
                  ? 'border-[var(--primary-color)] bg-[var(--primary-highlight)]' 
                  : 'border-[var(--border-color)] bg-[var(--background-card)] hover:bg-[var(--hover)]'
              }`}
            >
              <UploadCloud size={48} className={`mb-3 ${file ? 'text-[var(--primary-color)]' : 'text-[var(--text-tertiary)]'}`} />
              <h3 className="body-md" style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {file ? file.name : 'Drag & Drop .torrent File'}
              </h3>
              <p className="caption-text max-w-xs mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                {file ? 'File recognized. Ready to stream.' : 'Drop your locally saved torrent file here, or click to browse files.'}
              </p>
              <input
                type="file"
                accept=".torrent"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Status block */}
        </div>
      )}

      {/* ── TAB CONTENT: ACTIVE DOWNLOADS ── */}
      {activeTab === 'torrents' && (
        <div className="space-y-6 fade-in-only">

          {/* Bulk Pause / Resume All controls */}
          {hasActiveTorrents && torrents.length > 0 && (
            <div className="flex items-center justify-between bg-[var(--background-card)] border border-[var(--border-color)] p-3 rounded-xl">
              <p className="body-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                {torrents.filter(t => !t.done).length} active download(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePauseResumeAll(allPaused ? 'resume' : 'pause')}
                  className="flex items-center gap-2 outline-btn px-4 py-2"
                >
                  {allPaused ? <Play size={14} /> : <Pause size={14} />}
                  <span className="caption-text" style={{ fontWeight: 600 }}>
                    {allPaused ? 'RESUME ALL' : 'PAUSE ALL'}
                  </span>
                </button>
              </div>
            </div>
          )}
          
          {torrents.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed border-[var(--border-color)] rounded-2xl bg-[var(--background-card)]">
              <Activity size={48} className="text-[var(--text-tertiary)] mb-4 animate-pulse" />
              <h3 className="body-md" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>No Active Torrent Downloads</h3>
              <p className="body-sm mt-2 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Add a magnet link or upload a torrent file in the first tab to begin high-speed server caching.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {torrents.map((torrent) => (
                <div 
                  key={torrent.infoHash} 
                  className="bg-[var(--background-card)] border border-[var(--border-color)] rounded-xl p-6 relative overflow-hidden elevation-3"
                >
                  
                  {/* Subtle dynamic background progress indicator */}
                  <div 
                    className="absolute left-0 top-0 bottom-0 bg-[var(--primary-color)]/5 pointer-events-none transition-all duration-500 ease-out border-r border-[var(--primary-color)]/10"
                    style={{ width: `${(torrent.progress || 0) * 100}%` }}
                  />

                  <div className="relative z-10 space-y-4">
                    {/* Torrent Title and Overall Progress */}
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="body-md truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }} title={torrent.name}>
                            {torrent.name || 'Fetching torrent metadata...'}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {!torrent.done && (
                              <button
                                onClick={() => handleTorrentAction(torrent.infoHash, torrent.paused ? 'resume' : 'pause')}
                                className="p-1.5 rounded-md bg-[var(--background-secondary)] text-[var(--text-secondary)] hover:text-[var(--primary-color)] transition-colors border border-[var(--border-color)]"
                                title={torrent.paused ? "Resume Download" : "Pause Download"}
                              >
                                {torrent.paused ? <Play size={14} /> : <Pause size={14} />}
                              </button>
                            )}
                            <button
                              onClick={() => setPendingCleanup(torrent.infoHash)}
                              className="p-1.5 rounded-md bg-[var(--background-secondary)] text-[var(--text-secondary)] hover:text-[var(--danger-color)] transition-colors border border-[var(--border-color)]"
                              title="Remove Torrent"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 mt-2 caption-mono text-[var(--text-secondary)]">
                          <span className="flex items-center gap-1"><HardDrive size={12} /> {formatBytes(torrent.length)}</span>
                          <span className="flex items-center gap-1"><Users size={12} /> {torrent.numPeers} peers</span>
                          {torrent.paused && !torrent.done && (
                            <span className="flex items-center gap-1 text-orange-500" style={{ fontWeight: 700 }}>
                              <Pause size={12} /> PAUSED
                            </span>
                          )}
                          {torrent.done && (
                            <span className="flex items-center gap-1 text-emerald-500" style={{ fontWeight: 700 }}>
                              <CheckCircle2 size={12} /> COMPLETED & SEEDING
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className="text-2xl text-[var(--primary-color)]" style={{ fontWeight: 900, fontFamily: 'var(--font-family-mono)' }}>
                          {((torrent.progress || 0) * 100).toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {/* Progress Slider Display */}
                    <div className="w-full bg-[var(--background-secondary)] rounded-full h-1.5 overflow-hidden border border-[var(--border-color)]">
                      <div 
                        className="h-full transition-all duration-500 rounded-full"
                        style={{ 
                          width: `${(torrent.progress || 0) * 100}%`,
                          background: 'linear-gradient(90deg, var(--primary-color), color-mix(in srgb, var(--primary-color) 40%, var(--accent-secondary)))'
                        }}
                      />
                    </div>

                    {/* Speeds & ETA Mono row */}
                    {!torrent.done ? (
                      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[var(--border-color)] caption-text" style={{ fontFamily: 'var(--font-family-mono)', color: 'var(--text-secondary)' }}>
                        <div className="flex flex-col">
                          <span style={{ color: 'var(--text-tertiary)', marginBottom: '4px' }}>DOWNLOAD SPEED</span>
                          <span className="flex items-center gap-1 text-[var(--primary-color)]" style={{ fontWeight: 700 }}>
                            <ArrowDown size={11} />
                            {torrent.numPeers === 0 && torrent.downloadSpeed === 0 
                              ? 'Searching peers...' 
                              : formatSpeed(torrent.downloadSpeed)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span style={{ color: 'var(--text-tertiary)', marginBottom: '4px' }}>UPLOAD SPEED</span>
                          <span className="flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                            <ArrowUp size={11} />
                            {formatSpeed(torrent.uploadSpeed)}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="flex items-center gap-1" style={{ color: 'var(--text-tertiary)', marginBottom: '4px' }}><Clock size={11} /> ETA</span>
                          <span style={{ color: 'var(--text-primary)' }}>
                            {!torrent.timeRemaining || torrent.timeRemaining <= 0 
                              ? 'Calculating...' 
                              : torrent.timeRemaining > 3600000 
                                ? `${Math.floor(torrent.timeRemaining / 1000 / 3600)}h ${Math.round((torrent.timeRemaining / 1000 % 3600) / 60)}m`
                                : torrent.timeRemaining > 60000
                                  ? `${Math.round(torrent.timeRemaining / 1000 / 60)} min`
                                  : `${Math.round(torrent.timeRemaining / 1000)}s`}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-4 border-t border-[var(--border-color)] caption-text text-emerald-500 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-family-mono)' }}>
                        <CheckCircle2 size={13} /> Complete! File is fully saved to server node cache and ready to load.
                      </div>
                    )}

                    {/* Individual File Listing tree */}
                    {torrent.files && torrent.files.length > 0 && (
                      <div className="pt-4 mt-4 border-t border-[var(--border-color)] space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="caption-text uppercase" style={{ fontWeight: 800, letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>
                            Captured File List
                          </h4>
                              {torrent.files.some(f => f.progress > 0) && (
                            <button
                              onClick={() => handleDownloadSelected(torrent)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg caption-text bg-[var(--primary-color)] hover:bg-[var(--primary-color-hover)] text-white transition-all"
                              style={{ fontWeight: 700 }}
                            >
                              <Download size={12} />
                              SAVE SELECTED ({(selectedFiles[torrent.infoHash]?.size || 0)})
                            </button>
                          )}
                        </div>
                        
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                          {torrent.files.map((file) => {
                            const isDone = file.progress >= 1.0;
                            const isSelected = selectedFiles[torrent.infoHash]?.has(file.index) || false;
                            return (
                              <div 
                                key={file.index} 
                                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 body-sm p-3 rounded-xl border transition-all ${
                                  isSelected 
                                    ? 'bg-[var(--primary-highlight)] border-[var(--primary-color)]/30' 
                                    : 'bg-[var(--background-secondary)] border-[var(--border-color)]'
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate pr-4 flex-1">
                                  {isDone && (
                                    <button
                                      onClick={() => toggleFileSelection(torrent.infoHash, file.index)}
                                      className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--background-card)] transition-colors"
                                      title={isSelected ? 'Deselect file' : 'Select file for download'}
                                    >
                                      {isSelected ? (
                                        <CheckSquare className="w-4 h-4 text-[var(--primary-color)]" />
                                      ) : (
                                        <Square className="w-4 h-4 text-[var(--text-tertiary)]" />
                                      )}
                                    </button>
                                  )}
                                  <span className="flex-shrink-0" style={{ fontSize: '16px', color: 'var(--text-tertiary)' }} role="img" aria-label="type">
                                    {isVideoFile(file.name) ? <FileVideo className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                                  </span>
                                  <span className="truncate body-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }} title={file.name}>
                                    {file.name}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-4 min-w-[220px]">
                                  <span className="caption-mono text-[var(--text-tertiary)]">
                                    {formatBytes(file.length)}
                                  </span>
                                  
                                  <a 
                                    href={`${TORRENT_SERVER_URL}/api/torrents/${encodeURIComponent(torrent.infoHash)}/files/${file.index}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => {
                                      if (file.progress <= 0) {
                                        e.preventDefault();
                                        setAddStatus('Info: File has no data on disk yet. Please wait for the download to start.');
                                      } else if (!isDone) {
                                        setAddStatus(`Info: Downloading ${file.name} — ${(file.progress * 100).toFixed(0)}% of data available on disk.`);
                                      }
                                    }}
                                    className={`px-3 py-1.5 rounded-lg caption-text flex items-center gap-1.5 transition-all ${
                                      file.progress <= 0
                                        ? 'bg-[var(--background-card)] text-[var(--text-tertiary)] cursor-not-allowed opacity-60 border border-[var(--border-color)]' 
                                        : !isDone
                                          ? 'bg-[var(--accent-secondary)] hover:bg-[var(--accent-secondary-hover)] text-white'
                                          : 'bg-[var(--primary-color)] hover:bg-[var(--primary-color-hover)] text-white'
                                    }`}
                                    style={{ fontWeight: 700 }}
                                  >
                                    <Download size={12} />
                                    {file.progress <= 0 ? 'Wait (0%)' : !isDone ? `Save (${(file.progress * 100).toFixed(0)}%)` : 'SAVE FILE'}
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      {pendingCleanup !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setPendingCleanup(null)}>
          <div className="panel-card p-6 max-w-sm mx-4 animate-in-item" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 text-[var(--text-primary)]">{pendingCleanup === 'all' ? 'Clean disk & downloads?' : 'Remove this torrent?'}</h3>
            <p className="body-sm text-[var(--text-secondary)] mb-6">
              {pendingCleanup === 'all'
                ? 'This will remove ALL active downloads and clean all cached files from disk. Continue?'
                : 'Are you sure you want to remove this torrent and delete its cached files?'}
            </p>
            <div className="flex gap-3 justify-end">
              <button className="secondary-btn" onClick={() => setPendingCleanup(null)}>Cancel</button>
              <button className="primary-btn" onClick={confirmPendingCleanup} style={{ background: 'var(--danger-color)' }}>
                {pendingCleanup === 'all' ? 'Clean Everything' : 'Remove Torrent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TorrentConverterView;
