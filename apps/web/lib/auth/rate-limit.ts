interface WindowState {
  count: number;
  resetAt: number;
}

export class AuthRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now = () => Date.now(),
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    if (this.windows.size > 10_000) {
      for (const [entryKey, state] of this.windows) {
        if (state.resetAt <= now) this.windows.delete(entryKey);
      }
    }

    const state = this.windows.get(key);
    if (!state || state.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (state.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
      };
    }
    state.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function getRequestRateLimitKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  return forwardedFor?.split(",")[0]?.trim() || realIp || "unknown";
}