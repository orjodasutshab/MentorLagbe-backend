import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toNodeHandler } from 'better-auth/node';
import { validateRuntimeEnvironment, isOriginAllowed } from './config/env.ts';
import { getDb, pingDb } from './db.ts';
import { getBetterAuth } from './auth/betterAuth.ts';
import { seedDatabaseIfEmpty } from './utils/seedData.ts';
import { ensureExtrasSeeded } from './utils/extrasSeed.ts';
import { csrfOriginCheck, errorHandler } from './middleware/auth.ts';
import { apiWriteRateLimiter } from './middleware/rateLimit.ts';
import authRoutes from './routes/auth.ts';
import tuitionRoutes from './routes/tuitions.ts';
import applicationRoutes from './routes/applications.ts';
import userRoutes from './routes/users.ts';
import paymentRoutes, { stripeWebhookHandler } from './routes/payments.ts';
import adminRoutes from './routes/admin.ts';
import uploadRoutes, { UPLOAD_DIR } from './routes/upload.ts';
import tutorRoutes from './routes/tutors.ts';
import resourceRoutes from './routes/resources.ts';
import tutorRequestRoutes from './routes/tutorRequests.ts';
import messageRoutes from './routes/messages.ts';
import notificationRoutes from './routes/notifications.ts';
import quizRoutes from './routes/quizzes.ts';
import { extraFeaturesEnabled } from './config/features.ts';

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export async function createApiApp(): Promise<express.Express> {
  validateRuntimeEnvironment();

  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const db = await getDb();
  // Demo seed data contains well-known passwords (including an admin), so it never runs in production.
  if (!isProd && process.env.SEED_DEMO_DATA !== 'false') {
    await seedDatabaseIfEmpty(db);
    if (extraFeaturesEnabled()) await ensureExtrasSeeded(db);
  }
  const betterAuthInstance = await getBetterAuth();

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProd && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use((req, res, next) => {
    const requestHost = typeof req.headers.host === 'string' ? req.headers.host : undefined;
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, requestHost)) {
          callback(null, true);
        } else {
          callback(new Error('Origin not allowed by CORS policy'));
        }
      },
      credentials: true,
    })(req, res, (err) => {
      if (err) {
        res.status(403).json({ error: 'CORS origin denied.' });
        return;
      }
      next();
    });
  });

  // BetterAuth Node handler
  app.all('/api/better-auth/*', toNodeHandler(betterAuthInstance));

  // Stripe Webhook must receive raw body before express.json()
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json' }),
    stripeWebhookHandler,
  );

  app.use(cookieParser());
  app.use(csrfOriginCheck);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  } catch {
    // Read-only file systems (e.g. Vercel) can't create this folder; uploads go to Cloudinary/ImgBB there.
  }
  app.use('/api/uploads', express.static(UPLOAD_DIR));
  app.use('/api/assets', express.static(ASSETS_DIR, { maxAge: '7d' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      dbMode: db.mode,
      env: isProd ? 'production' : 'development',
    });
  });

  app.get('/api/health/ready', async (_req, res) => {
    const ping = await pingDb();
    if (!ping.ok) {
      res.status(503).json({ ok: false, dbMode: ping.mode, error: 'Database readiness check failed.' });
      return;
    }
    res.json({ ok: true, dbMode: ping.mode });
  });

  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      apiWriteRateLimiter(req, res, next);
      return;
    }
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/tuitions', tuitionRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/tutors', tutorRoutes);
  if (extraFeaturesEnabled()) {
    app.use('/api/resources', resourceRoutes);
    app.use('/api/tutor-requests', tutorRequestRoutes);
    app.use('/api/messages', messageRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/quizzes', quizRoutes);
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(errorHandler);
  return app;
}
