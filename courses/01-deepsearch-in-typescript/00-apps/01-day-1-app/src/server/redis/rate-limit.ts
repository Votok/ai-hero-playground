import { setTimeout as sleep } from "node:timers/promises";
import { redis } from "./redis";

export interface RateLimitConfig {
  maxRequests: number; // maximum number of requests allowed per window
  windowMs: number; // size of window in ms
  keyPrefix?: string; // redis key prefix namespace
  maxRetries?: number; // retry attempts when waiting for window reset
}

export interface RateLimitResult {
  allowed: boolean; // whether the request is allowed now
  remaining: number; // remaining requests in current window
  resetTime: number; // unix epoch ms when window resets
  totalHits: number; // current count in window
  retry: () => Promise<boolean>; // helper to wait and re-check up to maxRetries
}

function currentWindowStart(windowMs: number): number {
  const now = Date.now();
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Record a request (increment) in the current window. Uses INCR+EXPIRE pipelined.
 */
export async function recordRateLimit({
  windowMs,
  keyPrefix = "rate_limit",
}: Pick<RateLimitConfig, "windowMs" | "keyPrefix">): Promise<void> {
  const windowStart = currentWindowStart(windowMs);
  const key = `${keyPrefix}:${windowStart}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    // ensure expiry is at least windowMs; convert to seconds rounding up
    pipeline.expire(key, Math.ceil(windowMs / 1000));
    const results = await pipeline.exec();
    if (!results) {
      throw new Error("Redis pipeline execution failed");
    }
  } catch (error) {
    console.error("Rate limit recording failed:", error);
    throw error;
  }
}

/**
 * Non-destructive check of current window state.
 * Provides retry helper that will sleep until reset + re-check up to maxRetries.
 */
export async function checkRateLimit({
  maxRequests,
  windowMs,
  keyPrefix = "rate_limit",
  maxRetries = 3,
}: RateLimitConfig): Promise<RateLimitResult> {
  const windowStart = currentWindowStart(windowMs);
  const key = `${keyPrefix}:${windowStart}`;

  try {
    const currentCountRaw = await redis.get(key);
    const count = currentCountRaw ? parseInt(currentCountRaw, 10) : 0;
    const allowed = count < maxRequests;
    const remaining = Math.max(0, maxRequests - count);
    const resetTime = windowStart + windowMs;

    let retryCount = 0;

    const retry = async (): Promise<boolean> => {
      if (allowed) return true; // already allowed
      // wait until current window resets
      const waitMs = resetTime - Date.now();
      if (waitMs > 0) await sleep(waitMs);

      const recheck = await checkRateLimit({
        maxRequests,
        windowMs,
        keyPrefix,
        maxRetries,
      });
      if (recheck.allowed) return true;
      if (retryCount >= maxRetries) return false;
      retryCount++;
      return await recheck.retry();
    };

    return {
      allowed,
      remaining,
      resetTime,
      totalHits: count,
      retry,
    };
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // fail open to avoid user disruption if redis has issues
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: windowStart + windowMs,
      totalHits: 0,
      retry: async () => true,
    };
  }
}

/**
 * Convenience wrapper: ensure capacity (wait if needed) then record usage.
 * Returns final RateLimitResult after recording.
 */
export async function ensureRateLimit(
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const check = await checkRateLimit(config);
  if (!check.allowed) {
    const ok = await check.retry();
    if (!ok) return check; // give up; caller can decide
  }
  await recordRateLimit(config);
  return await checkRateLimit(config); // return fresh state
}
