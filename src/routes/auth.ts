import { Router, type Request } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb, generateId, isDuplicateKeyError } from '../db.ts';
import { getPrimaryAppOrigin, isOriginAllowed } from '../config/env.ts';
import {
  clearAuthCookie,
  COOKIE_MAX_AGE_MS,
  hashToken,
  sanitizeUser,
  setAuthCookie,
  signAuthToken,
  verifyToken,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { authRateLimiter } from '../middleware/rateLimit.ts';

const router = Router();

// Valid bcrypt hash of a random string; used only to equalise timing for unknown emails.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

interface PendingOAuthState {
  redirectUri: string;
  origin: string;
  expiresAt: number;
}

type PendingOAuthExchange =
  | {
      kind: 'existing';
      userId: string;
      email: string;
      expiresAt: number;
    }
  | {
      kind: 'new_profile';
      email: string;
      name: string;
      picture?: string;
      expiresAt: number;
    };

interface PendingGoogleRegistration {
  email: string;
  name: string;
  picture?: string;
  expiresAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();
const pendingOAuthExchanges = new Map<string, PendingOAuthExchange>();
const pendingGoogleRegistrations = new Map<string, PendingGoogleRegistration>();

function cleanupExpiredOAuthEntries() {
  const now = Date.now();
  for (const [k, v] of pendingOAuthStates.entries()) {
    if (v.expiresAt < now) pendingOAuthStates.delete(k);
  }
  for (const [k, v] of pendingOAuthExchanges.entries()) {
    if (v.expiresAt < now) pendingOAuthExchanges.delete(k);
  }
  for (const [k, v] of pendingGoogleRegistrations.entries()) {
    if (v.expiresAt < now) pendingGoogleRegistrations.delete(k);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeHttpsUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveAppBaseOrigin(req: Request): string {
  const queryOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim() : undefined;
  const headerOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : undefined;
  const candidateOrigin = queryOrigin || headerOrigin;
  const requestHost = typeof req.headers.host === 'string' ? req.headers.host : undefined;

  if (candidateOrigin && isOriginAllowed(candidateOrigin, requestHost)) {
    try {
      return new URL(candidateOrigin).origin.replace(/\/+$/, '');
    } catch {
      // fall through
    }
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && !appUrl.includes('localhost')) {
    try {
      return new URL(appUrl).origin.replace(/\/+$/, '');
    } catch {
      // fall through
    }
  }

  return getPrimaryAppOrigin(headerOrigin, requestHost).replace(/\/+$/, '');
}

const signUpSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(80),
  email: z.string().trim().email('Please provide a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  role: z.enum(['student', 'tutor']),
});

const signInSchema = z.object({
  email: z.string().trim().email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

async function createSessionAndToken(userId: string, email: string): Promise<string> {
  const db = await getDb();
  const token = signAuthToken(userId, email);
  const expiresAtDate = new Date(Date.now() + COOKIE_MAX_AGE_MS);
  await db.auth_sessions.insertOne({
    _id: `ses_${generateId()}`,
    userId,
    userEmail: email,
    tokenHash: hashToken(token),
    expiresAt: expiresAtDate.toISOString(),
    expiresAtDate,
    createdAt: new Date().toISOString(),
  });
  return token;
}

router.post('/sign-up', authRateLimiter, async (req, res, next) => {
  try {
    const parsed = signUpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
      return;
    }

    const { name, email, password, role } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const db = await getDb();

    const existing = await db.users.findByField('email', normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const defaultAvatar =
      role === 'tutor'
        ? '/api/assets/default-avatar.svg'
        : '/api/assets/default-avatar.svg';

    let created;
    try {
      created = await db.users.insertOne({
        _id: `usr_${generateId()}`,
        name,
        email: normalizedEmail,
        image: defaultAvatar,
        role,
        phone: '',
        bio: '',
        plan: 'free',
        savedTuitionIds: [],
        passwordHash,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }
      throw err;
    }

    const token = await createSessionAndToken(created._id, created.email);
    setAuthCookie(req, res, token);

    res.status(201).json({
      user: sanitizeUser(created),
      token,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sign-in', authRateLimiter, async (req, res, next) => {
  try {
    const parsed = signInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credentials.' });
      return;
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const db = await getDb();

    const user = await db.users.findByField('email', normalizedEmail);
    // Always run one bcrypt compare so response time doesn't reveal whether the email exists.
    const valid = await bcrypt.compare(password, user?.passwordHash || DUMMY_BCRYPT_HASH);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = await createSessionAndToken(user._id, user.email);
    setAuthCookie(req, res, token);

    res.json({
      user: sanitizeUser(user),
      token,
    });
  } catch (err) {
    next(err);
  }
});

// Google OAuth 2.0 configuration status (never exposes secrets)
router.get('/google/status', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const origin = resolveAppBaseOrigin(req);
  res.json({
    configured: Boolean(clientId && clientSecret),
    callbackUrl: `${origin}/api/auth/google/callback`,
  });
});

// Generate direct Google OAuth URL for popup flow
router.get('/google/url', authRateLimiter, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const origin = resolveAppBaseOrigin(req);
  const redirectUri = `${origin}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    res.status(503).json({
      error: `Google Login requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to be configured in environment secrets with callback URL: ${redirectUri}`,
      code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
      callbackUrl: redirectUri,
    });
    return;
  }

  cleanupExpiredOAuthEntries();
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthStates.set(state, {
    redirectUri,
    origin,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  res.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
});

function renderOAuthPopupHtml(payload: Record<string, unknown>, targetOrigin: string, message: string): string {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const serializedOrigin = JSON.stringify(targetOrigin).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Google Sign-In — MentorLagbe</title></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F5F8FC;color:#0F2438;">
    <div style="text-align:center;padding:24px;max-width:360px;">
      <p style="font-size:15px;font-weight:600;">${escapeHtml(message)}</p>
      <p style="font-size:12px;color:#52657A;">This window will close automatically.</p>
    </div>
    <script>
      (function() {
        var payload = ${serializedPayload};
        var targetOrigin = ${serializedOrigin};
        if (window.opener) {
          try {
            window.opener.postMessage(payload, targetOrigin);
          } catch (e) {
            // Never fall back to a wildcard origin: the payload carries a one-time sign-in code.
          }
          window.close();
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`;
}

// Handle Google OAuth 2.0 callback (both with and without trailing slash)
router.get(['/google/callback', '/google/callback/'], async (req, res) => {
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  cleanupExpiredOAuthEntries();
  const stateEntry = state ? pendingOAuthStates.get(state) : undefined;
  if (state) pendingOAuthStates.delete(state);

  const fallbackOrigin = stateEntry?.origin || resolveAppBaseOrigin(req);

  if (oauthError) {
    res
      .status(400)
      .send(
        renderOAuthPopupHtml(
          { type: 'OAUTH_AUTH_ERROR', error: 'Google sign-in was cancelled or denied.' },
          fallbackOrigin,
          'Google sign-in was cancelled.',
        ),
      );
    return;
  }

  if (!code || !stateEntry || stateEntry.expiresAt < Date.now()) {
    res
      .status(400)
      .send(
        renderOAuthPopupHtml(
          { type: 'OAUTH_AUTH_ERROR', error: 'Invalid or expired OAuth state. Please try again.' },
          fallbackOrigin,
          'Session expired. Please retry Google Sign-In.',
        ),
      );
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    res
      .status(503)
      .send(
        renderOAuthPopupHtml(
          { type: 'OAUTH_AUTH_ERROR', error: 'Google OAuth credentials are not configured.' },
          fallbackOrigin,
          'Google OAuth is not configured.',
        ),
      );
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: stateEntry.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      res
        .status(401)
        .send(
          renderOAuthPopupHtml(
            { type: 'OAUTH_AUTH_ERROR', error: 'Failed to verify Google authorization code.' },
            stateEntry.origin,
            'Could not complete Google Sign-In.',
          ),
        );
      return;
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new Error('Missing access token from Google.');
    }

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userInfoRes.ok) {
      throw new Error('Failed to fetch Google user profile.');
    }

    const profile = (await userInfoRes.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!profile.email || profile.email_verified !== true) {
      res
        .status(403)
        .send(
          renderOAuthPopupHtml(
            { type: 'OAUTH_AUTH_ERROR', error: 'Your Google account must have a verified email address.' },
            stateEntry.origin,
            'Verified Google email is required.',
          ),
        );
      return;
    }

    const normalizedEmail = profile.email.toLowerCase();
    const db = await getDb();
    let user = await db.users.findByField('email', normalizedEmail);
    const verifiedPicture = isSafeHttpsUrl(profile.picture) ? profile.picture! : undefined;

    const exchangeCode = crypto.randomBytes(24).toString('hex');

    if (user) {
      if (verifiedPicture && (user.image.startsWith('/src/assets/') || user.image.startsWith('/api/assets/'))) {
        const updated = await db.users.updateOne(
          (u) => u._id === user!._id,
          (u) => ({ ...u, image: verifiedPicture }),
        );
        if (updated) user = updated;
      }

      pendingOAuthExchanges.set(exchangeCode, {
        kind: 'existing',
        userId: user._id,
        email: user.email,
        expiresAt: Date.now() + 60 * 1000,
      });

      res.send(
        renderOAuthPopupHtml(
          { type: 'OAUTH_AUTH_SUCCESS', code: exchangeCode },
          stateEntry.origin,
          `Signed in as ${user.name}. Redirecting...`,
        ),
      );
      return;
    }

    const displayName = (profile.name || normalizedEmail.split('@')[0]).trim().slice(0, 80);
    pendingOAuthExchanges.set(exchangeCode, {
      kind: 'new_profile',
      email: normalizedEmail,
      name: displayName,
      picture: verifiedPicture,
      expiresAt: Date.now() + 2 * 60 * 1000,
    });

    res.send(
      renderOAuthPopupHtml(
        { type: 'OAUTH_AUTH_SUCCESS', code: exchangeCode },
        stateEntry.origin,
        `Google verified for ${displayName}. Select your account type...`,
      ),
    );
  } catch (err) {
    console.error('[Google OAuth Error]', err);
    res
      .status(500)
      .send(
        renderOAuthPopupHtml(
          { type: 'OAUTH_AUTH_ERROR', error: 'Google authentication failed. Please try again.' },
          stateEntry.origin,
          'Authentication failed.',
        ),
      );
  }
});

// Exchange one-time OAuth code for either an active session or a role-selection setupToken
router.post('/google/exchange', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({ code: z.string().min(16).max(128) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid OAuth exchange code.' });
      return;
    }

    cleanupExpiredOAuthEntries();
    const entry = pendingOAuthExchanges.get(parsed.data.code);
    pendingOAuthExchanges.delete(parsed.data.code);

    if (!entry || entry.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Google sign-in session expired. Please try again.' });
      return;
    }

    if (entry.kind === 'new_profile') {
      const setupToken = crypto.randomBytes(24).toString('hex');
      pendingGoogleRegistrations.set(setupToken, {
        email: entry.email,
        name: entry.name,
        picture: entry.picture,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      res.json({
        needsRoleSelection: true,
        setupToken,
        profile: {
          name: entry.name,
          email: entry.email,
          image: entry.picture,
        },
      });
      return;
    }

    const db = await getDb();
    const user = await db.users.findById(entry.userId);
    if (!user) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    const token = await createSessionAndToken(user._id, user.email);
    setAuthCookie(req, res, token);

    res.json({
      needsRoleSelection: false,
      user: sanitizeUser(user),
      token,
    });
  } catch (err) {
    next(err);
  }
});

// Finish first-time Google sign-in after user selects Student or Tutor role
router.post('/google/complete', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      setupToken: z.string().min(16).max(128),
      role: z.enum(['student', 'tutor']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please choose whether this is a Student or Tutor account.' });
      return;
    }

    cleanupExpiredOAuthEntries();
    const pending = pendingGoogleRegistrations.get(parsed.data.setupToken);
    pendingGoogleRegistrations.delete(parsed.data.setupToken);

    if (!pending || pending.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Google account setup expired. Please sign in with Google again.' });
      return;
    }

    const db = await getDb();
    const existing = await db.users.findByField('email', pending.email.toLowerCase());
    if (existing) {
      const token = await createSessionAndToken(existing._id, existing.email);
      setAuthCookie(req, res, token);
      res.json({ user: sanitizeUser(existing), token });
      return;
    }

    const defaultAvatar =
      parsed.data.role === 'tutor'
        ? '/api/assets/default-avatar.svg'
        : '/api/assets/default-avatar.svg';

    const created = await db.users.insertOne({
      _id: `usr_${generateId()}`,
      name: pending.name,
      email: pending.email.toLowerCase(),
      image: pending.picture || defaultAvatar,
      role: parsed.data.role,
      phone: '',
      bio: '',
      plan: 'free',
      savedTuitionIds: [],
      createdAt: new Date().toISOString(),
    });

    const token = await createSessionAndToken(created._id, created.email);
    setAuthCookie(req, res, token);

    res.status(201).json({
      user: sanitizeUser(created),
      token,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sign-out', async (req: AuthenticatedRequest, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null) ||
      (typeof req.cookies?.ml_token === 'string' ? req.cookies.ml_token : null);

    if (token) {
      const db = await getDb();
      await db.auth_sessions.deleteOne((s) => s.tokenHash === hashToken(token));
    }

    clearAuthCookie(req, res);
    res.json({ message: 'Signed out successfully.' });
  } catch (err) {
    next(err);
  }
});

router.get('/session', verifyToken, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user, token: req.token });
});

export default router;
