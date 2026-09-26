// ── Torrent speed measurement ─────────────────────────────────────────────
//
// A fixed 500 ms sampler (see `startSpeedSampler` usage in server.ts) pushes
// torrent.received / torrent.uploaded — the exact monotonic payload-byte
// counters WebTorrent increments on every 'download'/'upload' peer event —
// into `recordSpeedSample`. Those are the bytes that actually cross the wire,
// so the derived rate is the real throughput, identical for every client.
//
// The previous implementation sampled torrent.downloaded (a bitfield/partial-
// piece counter that can jump backwards on a failed hash check) from *inside*
// the HTTP stats handler, i.e. only when a UI polled, over a 10 s window.
// The main app polls every 500 ms and the StreamTor UI every 1000 ms, so two
// clients produced samples 100-300 ms apart, tripped the old <300 ms guard,
// and bounced the reported value onto WebTorrent's separate 5 s average — the
// number on screen never lined up with the real speed. Sampling is now
// decoupled from HTTP entirely and uses a 3 s window, so it tracks actual
// throughput closely.

const SPEED_WINDOW_MS = 3000;           // 3-second sliding window
const SPEED_MIN_SPAN_MS = 250;          // ignore degenerate sub-250 ms spans
const SPEED_CACHE_TTL_MS = 5000;        // no fresh sample ⇒ fall back to WebTorrent

export const SPEED_SAMPLE_INTERVAL_MS = 500; // sample every 500 ms regardless of polling

type SpeedSample = { ts: number; received: number; uploaded: number };
type SpeedReading = { down: number; up: number; updatedAt: number };

const speedSamples = new Map<string, SpeedSample[]>();
const speedCache = new Map<string, SpeedReading>();

export function recordSpeedSample(infoHash: string, receivedBytes: number, uploadedBytes: number) {
  const now = Date.now();
  let samples = speedSamples.get(infoHash);

  if (!samples) {
    samples = [];
    speedSamples.set(infoHash, samples);
  }

  samples.push({ ts: now, received: receivedBytes, uploaded: uploadedBytes });

  // Drop samples that fell out of the window (always keep the newest pair)
  const cutoff = now - SPEED_WINDOW_MS;
  while (samples.length > 1 && samples[0].ts < cutoff) {
    samples.shift();
  }

  if (samples.length < 2) return;

  const oldest = samples[0];
  const newest = samples[samples.length - 1];

  // Counter went backwards → stale buffer from a previous session of the same
  // infoHash. Restart the window instead of reporting a bogus rate.
  if (newest.received < oldest.received || newest.uploaded < oldest.uploaded) {
    speedSamples.set(infoHash, [newest]);
    speedCache.set(infoHash, { down: 0, up: 0, updatedAt: now });
    return;
  }

  const spanMs = newest.ts - oldest.ts;
  if (spanMs < SPEED_MIN_SPAN_MS) return;

  const spanSec = spanMs / 1000;
  speedCache.set(infoHash, {
    down: (newest.received - oldest.received) / spanSec,
    up: (newest.uploaded - oldest.uploaded) / spanSec,
    updatedAt: now
  });
}

export function getMeasuredSpeed(infoHash: string, t: any) {
  const cached = speedCache.get(infoHash);
  if (cached && Date.now() - cached.updatedAt <= SPEED_CACHE_TTL_MS) {
    return { down: cached.down, up: cached.up };
  }
  // No samples yet (torrent added <500 ms ago / sampler not ticked): WebTorrent's
  // own counters are fed live by peer events too, so they are a safe interim value.
  return {
    down: typeof t?.downloadSpeed === 'number' ? t.downloadSpeed : 0,
    up: typeof t?.uploadSpeed === 'number' ? t.uploadSpeed : 0
  };
}

export function resetSpeedSmoothing(infoHash: string) {
  speedSamples.delete(infoHash);
  speedCache.delete(infoHash);
}
