import { describe, expect, it } from "vitest";
import { createLoginLimiter, loginLimiter } from "../src/auth/login-limiter.js";

const WINDOW_MS = 900_000;

// Horloge pilotable : chaque test avance le temps à la main, sans attendre.
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe("login limiter: blocage au seuil", () => {
  it("does not block after four failures", () => {
    const limiter = createLoginLimiter({ now: fakeClock().now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 4; i++) limiter.recordFailure("alice");
    expect(limiter.check("alice").allowed).toBe(true);
    expect(limiter.check("alice").retryAfterSeconds).toBe(0);
  });

  it("blocks on the fifth failure, with a positive retryAfterSeconds", () => {
    const limiter = createLoginLimiter({ now: fakeClock().now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 5; i++) limiter.recordFailure("alice");
    const result = limiter.check("alice");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("gives the default threshold (5 failures) and window (900000 ms) when no options are given", () => {
    const clock = fakeClock();
    const limiter = createLoginLimiter({ now: clock.now });
    for (let i = 0; i < 4; i++) limiter.recordFailure("alice");
    expect(limiter.check("alice").allowed).toBe(true);

    limiter.recordFailure("alice");
    const blocked = limiter.check("alice");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(900);
  });

  it("exports a shared loginLimiter instance that applies the same rules", () => {
    const handle = "shared-instance-test";
    for (let i = 0; i < 5; i++) loginLimiter.recordFailure(handle);
    const result = loginLimiter.check(handle);
    loginLimiter.reset(handle);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(loginLimiter.check(handle)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});

describe("login limiter: retryAfterSeconds", () => {
  it("counts down to the moment the oldest failure leaves the window, rounded up to the next second", () => {
    const clock = fakeClock();
    const limiter = createLoginLimiter({ now: clock.now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 5; i++) limiter.recordFailure("alice");

    clock.advance(100_000);
    expect(limiter.check("alice").retryAfterSeconds).toBe(800);

    clock.advance(500);
    expect(limiter.check("alice").retryAfterSeconds).toBe(800);
  });
});

describe("login limiter: fenêtre glissante", () => {
  it("allows the handle again once the failures are older than the window", () => {
    const clock = fakeClock();
    const limiter = createLoginLimiter({ now: clock.now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 5; i++) limiter.recordFailure("alice");
    expect(limiter.check("alice").allowed).toBe(false);

    clock.advance(WINDOW_MS + 1);
    expect(limiter.check("alice")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("forgets old failures and only counts the ones still inside the window", () => {
    const clock = fakeClock();
    const limiter = createLoginLimiter({ now: clock.now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 4; i++) limiter.recordFailure("alice");

    clock.advance(WINDOW_MS + 1);
    for (let i = 0; i < 4; i++) limiter.recordFailure("alice");
    expect(limiter.check("alice").allowed).toBe(true);

    limiter.recordFailure("alice");
    expect(limiter.check("alice").allowed).toBe(false);
  });
});

describe("login limiter: reset et isolation", () => {
  it("reset clears the counter of a blocked handle", () => {
    const limiter = createLoginLimiter({ now: fakeClock().now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 5; i++) limiter.recordFailure("alice");
    expect(limiter.check("alice").allowed).toBe(false);

    limiter.reset("alice");
    expect(limiter.check("alice")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("keeps independent counters for two handles", () => {
    const limiter = createLoginLimiter({ now: fakeClock().now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 5; i++) limiter.recordFailure("alice");

    expect(limiter.check("alice").allowed).toBe(false);
    expect(limiter.check("bob").allowed).toBe(true);
  });

  it("resetting one handle does not touch the other", () => {
    const limiter = createLoginLimiter({ now: fakeClock().now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 5; i++) limiter.recordFailure("alice");
    for (let i = 0; i < 5; i++) limiter.recordFailure("bob");

    limiter.reset("alice");
    expect(limiter.check("alice").allowed).toBe(true);
    expect(limiter.check("bob").allowed).toBe(false);
  });

  it("shares one counter between Alice and alice (case-insensitive handles)", () => {
    const limiter = createLoginLimiter({ now: fakeClock().now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 3; i++) limiter.recordFailure("Alice");
    for (let i = 0; i < 2; i++) limiter.recordFailure("alice");

    expect(limiter.check("alice").allowed).toBe(false);
    expect(limiter.check("Alice").allowed).toBe(false);
    expect(limiter.check("ALICE").allowed).toBe(false);
  });

  it("reset with a different casing clears the shared counter", () => {
    const limiter = createLoginLimiter({ now: fakeClock().now, maxFailures: 5, windowMs: WINDOW_MS });
    for (let i = 0; i < 5; i++) limiter.recordFailure("Alice");

    limiter.reset("alice");
    expect(limiter.check("Alice")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});
