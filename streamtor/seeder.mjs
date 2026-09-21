import WebTorrent from 'webtorrent';
import fs from 'node:fs';

const FILE = 'C:/Users/varun/AppData/Local/Temp/opencode/probe-in/seedfile4.bin';
const OUT = 'C:/Users/varun/AppData/Local/Temp/opencode/probe-in/fixture.torrent';
const THROTTLE = 150 * 1024;

const client = new WebTorrent({ dht: true, tracker: false, utp: true, torrentPort: 0 });
client.throttleUpload(THROTTLE);
console.log('[seeder] upload throttled to ' + THROTTLE + ' B/s from start');
client.on('error', (e) => console.error('[seeder] client error', e));

client.seed(fs.readFileSync(FILE), { name: 'seedfile.bin' }, (torrent) => {
  console.log('[seeder] ready infoHash=' + torrent.infoHash + ' files=' + torrent.files.length);
  fs.writeFileSync(OUT, torrent.torrentFile);
  console.log('[seeder] fixture.torrent written (' + torrent.torrentFile.length + ' bytes)');
  torrent.on('upload', () => {
    if (!torrent._throttled) {
      torrent._throttled = true;
      client.throttleUpload(THROTTLE);
      console.log('[seeder] re-applied throttle to ' + THROTTLE + ' B/s');
    }
  });
  setInterval(() => {
    console.log('[seeder] uploaded=' + torrent.uploaded + ' peers=' + torrent.numPeers + ' rate=' + torrent.uploadSpeed);
  }, 5000);
});

setInterval(() => {
  console.log('[seeder] dht-nodes=' + (client.dht ? client.dht.nodes.size : 0) + ' peers=' + (client._tcpServer ? client._tcpServer.connections : 0));
}, 10000);