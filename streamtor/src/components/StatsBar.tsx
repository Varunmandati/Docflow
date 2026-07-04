import React from 'react';
import { useTorrents } from '../store/useTorrentStore';
import { ArrowDown, ArrowUp, HardDrive } from 'lucide-react';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function StatsBar() {
  const torrents = useTorrents() || [];
  
  const totalDownloadSpeed = torrents.reduce((acc, t) => acc + t.downloadSpeed, 0);
  const totalUploadSpeed = torrents.reduce((acc, t) => acc + t.uploadSpeed, 0);
  const totalPeers = torrents.reduce((acc, t) => acc + t.numPeers, 0);
  const activeCount = torrents.filter(t => !t.done).length;

  return (
    <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-3 flex gap-6 text-xs font-mono text-neutral-400 overflow-x-auto whitespace-nowrap hidden md:flex">
      <div className="flex items-center gap-2">
        <ArrowDown size={14} className="text-cyan-400" />
        <span className="text-white">{formatBytes(totalDownloadSpeed)}/s</span>
      </div>
      <div className="flex items-center gap-2">
        <ArrowUp size={14} className="text-emerald-400" />
        <span className="text-white">{formatBytes(totalUploadSpeed)}/s</span>
      </div>
      <div className="flex items-center gap-2 border-l border-neutral-800 pl-6">
        <span>Active Torrents:</span>
        <span className="text-white">{activeCount}</span>
      </div>
      <div className="flex items-center gap-2 border-l border-neutral-800 pl-6">
        <span>Global Peers:</span>
        <span className="text-white">{totalPeers}</span>
      </div>
    </div>
  );
}
