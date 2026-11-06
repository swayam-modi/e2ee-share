interface Entry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private map = new Map<string, Entry>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const entry = this.map.get(key);
    if (!entry || entry.resetAt <= now) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.max) return false;
    entry.count++;
    return true;
  }

  /** Remove entries whose window has already expired. */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.resetAt <= now) {
        this.map.delete(key);
      }
    }
  }
}

const roomsLimiter = new RateLimiter(10, 60_000);
const iceLimiter = new RateLimiter(30, 60_000);

// Purge expired entries every 2 minutes to prevent unbounded map growth under
// rotating IP addresses. unref() so this timer does not keep the process alive.
setInterval(() => {
  roomsLimiter.sweep();
  iceLimiter.sweep();
}, 120_000).unref();

export { roomsLimiter, iceLimiter };
