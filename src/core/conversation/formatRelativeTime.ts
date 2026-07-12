const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsedMs = now.getTime() - then.getTime();

  if (Number.isNaN(elapsedMs) || elapsedMs < MINUTE_MS) {
    return "Just now";
  }

  if (elapsedMs < HOUR_MS) {
    const minutes = Math.floor(elapsedMs / MINUTE_MS);
    return `${minutes}m ago`;
  }

  if (elapsedMs < DAY_MS) {
    const hours = Math.floor(elapsedMs / HOUR_MS);
    return `${hours}h ago`;
  }

  if (elapsedMs < 7 * DAY_MS) {
    const days = Math.floor(elapsedMs / DAY_MS);
    return `${days}d ago`;
  }

  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
