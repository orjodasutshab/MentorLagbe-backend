import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastCleanupAt = Date.now();

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastCleanupAt > 120_000) {
      for (const [k, b] of buckets.entries()) {
        if (b.resetAt <= now) buckets.delete(k);
      }
      lastCleanupAt = now;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = (req as Request & { user?: { _id?: string } }).user?._id;
    const key = `${options.keyPrefix}:${userId || ip}`;
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (existing.count >= options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: options.message || 'Too many requests. Please wait a moment before trying again.',
      });
      return;
    }

    existing.count += 1;
    buckets.set(key, existing);
    next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 40,
  keyPrefix: 'auth',
  message: 'Too many authentication attempts. Please try again in a minute.',
});

export const apiWriteRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  keyPrefix: 'write',
});

export const uploadRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 25,
  keyPrefix: 'upload',
  message: 'Too many file uploads. Please wait a minute before uploading again.',
});

export const paymentRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  keyPrefix: 'payment',
  message: 'Too many checkout requests. Please wait a minute before trying again.',
});
