export interface LoginLimiterOptions {
  now?: () => number;
  maxFailures?: number;
  windowMs?: number;
}

export interface LoginCheck {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface LoginLimiter {
  check(handle: string): LoginCheck;
  recordFailure(handle: string): void;
  reset(handle: string): void;
}

export function createLoginLimiter(options: LoginLimiterOptions = {}): LoginLimiter {
  const now = options.now ?? Date.now;
  const maxFailures = options.maxFailures ?? 5;
  const windowMs = options.windowMs ?? 900_000;
  const failures = new Map<string, number[]>();

  function recent(handle: string): number[] {
    const key = handle.toLowerCase();
    const current = now();
    const kept = (failures.get(key) ?? []).filter((at) => current - at < windowMs);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
    return kept;
  }

  return {
    check(handle) {
      const kept = recent(handle);
      const oldest = kept[0];
      if (kept.length < maxFailures || oldest === undefined) {
        return { allowed: true, retryAfterSeconds: 0 };
      }
      return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - now()) / 1000) };
    },
    recordFailure(handle) {
      const kept = recent(handle);
      kept.push(now());
      failures.set(handle.toLowerCase(), kept);
    },
    reset(handle) {
      failures.delete(handle.toLowerCase());
    },
  };
}

export const loginLimiter = createLoginLimiter();
