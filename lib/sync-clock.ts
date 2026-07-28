let offset = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let listeners: Array<(offset: number) => void> = [];

async function syncClock(): Promise<number> {
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
    samples.sort((a, b) => a - b);
    offset = samples[Math.floor(samples.length / 2)];
  }
  return offset;
}

export function startPeriodicSync(onSync?: (offset: number) => void): void {
  if (onSync) listeners.push(onSync);
  syncClock().then((off) => { onSync?.(off); });
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(async () => {
    const off = await syncClock();
    listeners.forEach((fn) => fn(off));
  }, 5000);
}

export function stopPeriodicSync(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  listeners = [];
}

export function getServerTime(): number {
  return Date.now() + offset;
}

export function getOffset(): number {
  return offset;
}
