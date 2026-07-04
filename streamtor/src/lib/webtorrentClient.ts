import type { Instance as WebTorrentInstance, Torrent } from 'webtorrent';
// @ts-ignore
import WebTorrent from 'webtorrent/dist/webtorrent.min.js';
import { makeFSChunkStore } from './FSChunkStore';

const WEBTORRENT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
  'wss://tracker.webtorrent.dev'
];

let client: WebTorrentInstance | null = null;

export function getClient(): WebTorrentInstance {
  if (!client) {
    client = new WebTorrent({
      tracker: {
        announce: WEBTORRENT_TRACKERS
      }
    });
    client.on('error', (err: any) => {
      console.error('WebTorrent Error:', err);
    });
  }
  return client;
}

export function destroyClient() {
  if (client) {
    client.destroy();
    client = null;
  }
}

export function downloadTorrent(
  magnetURIOrFile: string | File,
  dirHandle: FileSystemDirectoryHandle,
  onTorrent: (torrent: Torrent) => void
) {
  const wt = getClient();
  const store = makeFSChunkStore(dirHandle);

  return wt.add(magnetURIOrFile, { store, announce: WEBTORRENT_TRACKERS }, (torrent) => {
    console.log('Torrent added safely with custom filesystem store', torrent.infoHash);
    onTorrent(torrent);
  });
}
