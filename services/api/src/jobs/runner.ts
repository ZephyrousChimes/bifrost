export function startJob(name: string, intervalMs: number, fn: () => Promise<void>): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout;

  const tick = async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[JOB:${name}] run failed`, err);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
