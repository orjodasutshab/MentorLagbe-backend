import type { CookieOptions, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../db.ts';
import { isOriginAllowed, isProduction, isStrongSecret } from '../config/env.ts';
import type { UserDoc } from '../types.ts';

export interface AuthenticatedRequest extends Request {
  user?: Omit<UserDoc, 'passwordHash'>;
  token?: string;
}

export const AUTH_COOKIE_NAME = 'ml_token';
export const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let ephemeralDevJwtSecret: string | null = null;

export function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (isProduction()) {
    if (!isStrongSecret(configured, 32)) {
      throw new Error('JWT_SECRET must be configured with a strong 32+ char secret in production.');
    }
    return configured!;
  }
  if (configured) return configured;
  if (!ephemeralDevJwtSecret) {
    ephemeralDevJwtSecret = crypto.randomBytes(32).toString('hex');
  }
  return ephemeralDevJwtSecret;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAuthToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, getJwtSecret(), { expiresIn: '7d' });
}

export function setAuthCookie(req: Request, res: Response, token: string): void {
  const isHttps = Boolean(
    req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      process.env.APP_URL?.startsWith('https://'),
  );
  const options: CookieOptions & { partitioned?: boolean } = {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    ...(isHttps ? { partitioned: true } : {}),
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
  res.cookie(AUTH_COOKIE_NAME, token, options as CookieOptions);
}

export function clearAuthCookie(req: Request, res: Response): void {
  const isHttps = Boolean(
    req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      process.env.APP_URL?.startsWith('https://'),
  );
  const options: CookieOptions & { partitioned?: boolean } = {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    ...(isHttps ? { partitioned: true } : {}),
    path: '/',
  };
  res.clearCookie(AUTH_COOKIE_NAME, options as CookieOptions);
}

export function sanitizeUser(user: UserDoc): Omit<UserDoc, 'passwordHash'> {
  const { passwordHash: _omit, ...safe } = user;
  return {
    ...safe,
    facebookUrl: safe.facebookUrl || '',
    youtubeUrl: safe.youtubeUrl || '',
    coins: typeof safe.coins === 'number' ? safe.coins : 0,
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && token !== 'null' && token !== 'undefined') return token;
  }
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

/**
 * Verifies Origin / Referer on state-changing requests authenticated via cookies
 * when no explicit Bearer token is attached.
 */
export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  if (req.path === '/api/payments/webhook') {
    next();
    return;
  }
  const hasCookie = Boolean(req.cookies?.[AUTH_COOKIE_NAME]);
  const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
  if (hasCookie && !hasBearer) {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
    const requestHost = typeof req.headers.host === 'string' ? req.headers.host : undefined;
    let checkOrigin = origin;
    if (!checkOrigin && referer) {
      try {
        checkOrigin = new URL(referer).origin;
      } catch {
        checkOrigin = undefined;
      }
    }
    if (checkOrigin && !isOriginAllowed(checkOrigin, requestHost)) {
      res.status(403).json({ error: 'Cross-origin state mutation denied.' });
      return;
    }
  }
  next();
}

export async function verifyToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }

    let decoded: { userId: string; email: string };
    try {
      decoded = jwt.verify(token, getJwtSecret()) as { userId: string; email: string };
    } catch {
      res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
      return;
    }

    const db = await getDb();
    const tokenHash = hashToken(token);
    const session = await db.auth_sessions.findByField('tokenHash', tokenHash);
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      if (session) {
        await db.auth_sessions.deleteOne((s) => s._id === session._id).catch(() => false);
      }
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }

    const dbUser = await db.users.findById(decoded.userId);
    if (!dbUser) {
      res.status(401).json({ error: 'User account not found.' });
      return;
    }

    req.user = sanitizeUser(dbUser);
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { userId: string };
      const db = await getDb();
      const session = await db.auth_sessions.findByField('tokenHash', hashToken(token));
      if (session && new Date(session.expiresAt).getTime() >= Date.now()) {
        const dbUser = await db.users.findById(decoded.userId);
        if (dbUser) {
          req.user = sanitizeUser(dbUser);
          req.token = token;
        }
      }
    } catch {
      // Ignore invalid optional token
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function verifyStudent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'student') {
    res.status(403).json({ error: 'Access restricted to Student accounts.' });
    return;
  }
  next();
}

export function verifyTutor(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'tutor') {
    res.status(403).json({ error: 'Access restricted to Tutor accounts.' });
    return;
  }
  next();
}

export function verifyAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Access restricted to Admin accounts.' });
    return;
  }
  next();
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[API Error]', err);
  const message =
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred.'
      : err instanceof Error
        ? err.message
        : 'Internal server error';
  res.status(500).json({ error: message });
}
