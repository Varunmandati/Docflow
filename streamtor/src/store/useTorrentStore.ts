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

// Shared singleton state + a single poller. Previously each component that
// called useTorrents() mounted its OWN 1s setInterval, so StatsBar and
// TorrentList polled independently (interleaved ~every 500ms). That kept
// colliding with the server's 800ms speed-measurement gate and made the UI
// fall back to WebTorrent's laggy 5s average — speeds looked wrong and the
// two components even showed different values. Now there is exactly one
// interval shared by every subscriber.
let currentTorrents: TorrentStats[] = [];
const listeners = new Set<() => void>();
let pollStarted = false;

function notify() {
  listeners.forEach((l) => l());
}

async function pollTorrents() {
  try {
    const response = await fetch('/api/torrents');
    if (response.ok) {
      const data = await response.json();
      currentTorrents = data;
      notify();
    }
  } catch (err) {
    console.error('Failed to fetch torrents', err);
  }
}

function ensurePolling() {
  if (pollStarted) return;
  pollStarted = true;
  setInterval(pollTorrents, 1000);
  pollTorrents();
}

export function useTorrents() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    ensurePolling();
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return currentTorrents;
}
