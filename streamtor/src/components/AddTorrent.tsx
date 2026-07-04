import React, { useState, useRef } from 'react';
import { UploadCloud, Link as LinkIcon, DownloadCloud, Play } from 'lucide-react';

export default function AddTorrent({ onAdded }: { onAdded: () => void }) {
  const [magnet, setMagnet] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setMagnet('');
    }
  };

  const startDownload = async () => {
    if (!magnet && !file) return;

    try {
      setIsLoading(true);
      setStatus('Warming up torrent client...');
      
      let magnetLink = magnet;
      
      if (file) {
        setStatus('Parsing torrent file...');
        magnetLink = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(reader.result as string); // Returns data:application/x-bittorrent;base64,...
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      const res = await fetch('/api/torrents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: magnetLink })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to add torrent');
      }

      setStatus('Success! File is ready for download!');
      setTimeout(() => {
        onAdded();
      }, 1000);
      
    } catch (err: any) {
      setStatus(`Error: ${err.message || 'Failed to add torrent.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-white">Add Torrent</h2>
        <p className="text-neutral-400">Stream torrent data through our high-speed Node.js bridge.</p>
      </div>

      <div className="space-y-6">
        {/* Magnet Link Input */}
        <div className="space-y-4 bg-neutral-900 border border-neutral-800 p-6 rounded-xl">
          <div className="flex items-center gap-3 text-cyan-400 font-medium">
            <LinkIcon size={20} />
            <h3>Paste Magnet Link</h3>
          </div>
          <div className="flex gap-4">
            <input
              type="text"
              placeholder="magnet:?xt=urn:btih:..."
              value={magnet}
              onChange={(e) => {
                setMagnet(e.target.value);
                setFile(null);
              }}
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-center space-x-4">
          <div className="h-px bg-neutral-800 flex-1"></div>
          <span className="text-neutral-500 font-mono text-xs uppercase tracking-widest">OR</span>
          <div className="h-px bg-neutral-800 flex-1"></div>
        </div>

        {/* File Dropzone */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          className={`space-y-4 border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${file ? 'border-cyan-500 bg-cyan-500/5' : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700 hover:bg-neutral-800/50'}`}
        >
          <div className="flex justify-center">
            <UploadCloud size={40} className={file ? 'text-cyan-400' : 'text-neutral-600'} />
          </div>
          <div>
            <h3 className="text-neutral-200 font-medium">{file ? file.name : 'Click to select .torrent file'}</h3>
          </div>
          <input 
            type="file" 
            accept=".torrent" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileChange}
          />
        </div>

        {/* Action Bar */}
        <div className="pt-6 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 px-4 py-2 rounded border border-emerald-500/20">
            <DownloadCloud size={16} />
            <span>Files will be downloaded natively via browser</span>
          </div>
          
          <button
            onClick={startDownload}
            disabled={(!magnet && !file) || isLoading}
            className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-medium rounded-lg flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
          >
            <Play size={18} />
            <span>{isLoading ? 'Processing...' : 'Start Session'}</span>
          </button>
        </div>

        {status && (
          <div className={`p-4 rounded border text-sm font-mono break-all ${status.includes('Error') ? 'bg-red-500/10 border-red-500/20 text-red-400' : (status.includes('Success') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-neutral-900 border-neutral-800 text-neutral-300')}`}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
