let offset = 0;
let syncPromise: Promise<number> | null = null;

export async function syncClock(): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t1 = performance.now();
    const res = await fetch("/api/time");
    const { time: serverTime } = await res.json();
    const t4 = performance.now();
    const rtt = t4 - t1;
    if (rtt < 2000) samples.push(serverTime - (t1 + t4) / 2);
  }
  if (samples.length > 0) {
    samples.sort();
    offset = samples[Math.floor(samples.length / 2)];
  }
  return offset;
}

export function getServerTime(): number {
  return Date.now() + offset;
}

export function getOffset(): number {
  return offset;
}

export function ensureSynced(): Promise<number> {
  if (!syncPromise) syncPromise = syncClock();
  return syncPromise;
}
