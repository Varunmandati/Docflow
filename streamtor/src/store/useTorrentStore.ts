import { useEffect, useState } from 'react';

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
  files: { index: number; name: string; length: number; downloaded: number; progress: number }[];
}

export function useTorrents() {
  const [torrents, setTorrents] = useState<TorrentStats[]>([]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/torrents');
        if (response.ok) {
          const data = await response.json();
          setTorrents(data);
        }
      } catch (err) {
        console.error('Failed to fetch torrents', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return torrents;
}
