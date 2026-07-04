import React from 'react';
import { useTorrents } from '../store/useTorrentStore';
import { HardDrive, Activity, Users, Clock, PlayCircle, CheckCircle2, Download } from 'lucide-react';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function TorrentList() {
  const torrents = useTorrents() || [];

  if (torrents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-neutral-800 rounded-xl bg-neutral-900 border-dashed animate-in fade-in">
        <Activity size={48} className="text-neutral-700 mb-4" />
        <h3 className="text-lg font-medium text-neutral-300">No Active Downloads</h3>
        <p className="text-neutral-500 mt-2">Add a torrent to begin streaming data to disk.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          Active Downloads
          <span className="bg-neutral-800 text-neutral-400 text-xs px-2 py-1 rounded-full">{torrents.length}</span>
        </h2>
      </div>

      <div className="space-y-4">
        {torrents.map(torrent => (
          <div key={torrent.infoHash} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 overflow-hidden relative">
            {/* Progress Background */}
            <div 
              className="absolute left-0 top-0 bottom-0 bg-cyan-900/10 pointer-events-none transition-all duration-300 ease-out border-r border-cyan-500/20"
              style={{ width: `${torrent.progress * 100}%` }}
            ></div>
            
            <div className="relative z-10 space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="font-medium text-neutral-100 truncate max-w-[200px] sm:max-w-md lg:max-w-xl" title={torrent.name}>
                    {torrent.name || (torrent.infoHash.slice(0, 10) + '...')}
                  </h3>
                  <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500 font-mono">
                    <span className="flex items-center gap-1.5"><HardDrive size={13} /> {formatBytes(torrent.length)}</span>
                    <span className="flex items-center gap-1.5"><Users size={13} /> {torrent.numPeers} peers</span>
                    {torrent.done && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={13} /> Seeding</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-cyan-400">
                    {(torrent.progress * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              {!torrent.done ? (
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-neutral-800 text-xs font-mono relative">
                   <div className="flex flex-col">
                     <span className="text-neutral-600 mb-1">DOWNLOAD</span>
                     <span className="text-cyan-400">
                       {torrent.numPeers === 0 && torrent.downloadSpeed === 0 ? 'Searching for peers...' : `${formatBytes(torrent.downloadSpeed)}/s`}
                     </span>
                   </div>
                   <div className="flex flex-col">
                     <span className="text-neutral-600 mb-1">UPLOAD</span>
                     <span className="text-neutral-400">{formatBytes(torrent.uploadSpeed)}/s</span>
                   </div>
                   <div className="flex flex-col items-end">
                     <span className="text-neutral-600 mb-1 flex items-center gap-1"><Clock size={12} /> ETA</span>
                     <span className="text-neutral-300">
                       {torrent.timeRemaining === Infinity || torrent.timeRemaining === 0 
                         ? 'Calculating...' 
                         : `${Math.round(torrent.timeRemaining / 1000 / 60)} min`}
                     </span>
                   </div>
                </div>
              ) : (
                <div className="pt-4 border-t border-neutral-800 text-xs font-mono text-emerald-500 flex items-center gap-2">
                  <CheckCircle2 size={14} /> Torrent Metadata Loaded & Ready
                </div>
              )}

              {torrent.files && torrent.files.length > 0 && (
                <div className="pt-4 mt-4 border-t border-neutral-800 space-y-2">
                  <h4 className="text-xs uppercase tracking-widest text-neutral-600 mb-3">Files</h4>
                  {torrent.files.map((file) => (
                    <div key={file.index} className="flex justify-between items-center text-xs text-neutral-400 bg-neutral-950 p-3 rounded-lg border border-neutral-800/50">
                      <span className="truncate pr-4 flex-1">{file.name}</span>
                      <div className="flex items-center gap-4 min-w-[200px] justify-end">
                        <span className="font-mono text-neutral-500">{formatBytes(file.length)}</span>
                        
                        <a 
                          href={`/api/torrents/${encodeURIComponent(torrent.infoHash)}/files/${file.index}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (file.progress < 1) {
                              e.preventDefault();
                              alert('Because of cloud proxy timeout limits with large files, please wait for the server to finish acquiring this file (100%) before downloading it to your local device. Once it hits 100%, the full file will save quickly and reliably.');
                            }
                          }}
                          className={`px-3 py-1.5 rounded font-medium flex items-center gap-1.5 transition-colors ${file.progress < 1 ? 'bg-neutral-800/50 text-neutral-500 hover:bg-neutral-800/50 cursor-not-allowed opacity-50' : 'bg-neutral-800 hover:bg-neutral-700 text-white'}`}
                        >
                          <Download size={14} />
                          {file.progress < 1 ? `Wait (${(file.progress * 100).toFixed(0)}%)` : 'Save File'}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
