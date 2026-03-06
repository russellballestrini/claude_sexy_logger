/**
 * Simple in-memory sliding-window rate limiter.
 * Tracks event counts per key in 1-minute windows.
 */

interface Window {
  count: number;
  expiresAt: number;
}

const windows = new Map<string, Window>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (w.expiresAt < now) windows.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

/**
 * Check if a request is within rate limits.
 * @returns { allowed: true } or { allowed: false, retryAfterMs }
 */
export function checkRateLimit(
  key: string,
  count: number,
  maxPerMinute: number,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  if (!isFinite(maxPerMinute)) return { allowed: true };

  const now = Date.now();
  const w = windows.get(key);

  if (!w || w.expiresAt < now) {
    // New window
    windows.set(key, { count, expiresAt: now + 60_000 });
    return { allowed: true };
  }

  if (w.count + count > maxPerMinute) {
    return { allowed: false, retryAfterMs: w.expiresAt - now };
  }

  w.count += count;
  return { allowed: true };
}
