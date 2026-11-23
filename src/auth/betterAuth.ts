import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { bearer } from 'better-auth/plugins/bearer';
import { jwt } from 'better-auth/plugins/jwt';
import crypto from 'crypto';
import { getDb, type DatabaseHandle } from '../db.ts';
import { getAllowedOrigins, isProduction, isStrongSecret } from '../config/env.ts';

let devBetterAuthSecret: string | null = null;

function createBetterAuth(db: DatabaseHandle) {
  const baseURL =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    'http://localhost:3000';

  const configuredSecret =
    process.env.BETTER_AUTH_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (isProduction() && !isStrongSecret(configuredSecret, 32)) {
    throw new Error('BETTER_AUTH_SECRET or JWT_SECRET must be configured cleanly in production.');
  }
  if (!configuredSecret && !devBetterAuthSecret) {
    devBetterAuthSecret = crypto.randomBytes(32).toString('hex');
  }
  const secret = configuredSecret || devBetterAuthSecret!;

  const database =
    db.mode === 'mongodb' && db.mongoDb
      ? mongodbAdapter(db.mongoDb)
      : memoryAdapter({
          ba_users: [],
          session: [],
          account: [],
          verification: [],
          jwks: [],
        });

  return betterAuth({
    baseURL,
    basePath: '/api/better-auth',
    secret,
    database,
    user: {
      modelName: 'ba_users',
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'student',
          input: false,
        },
        plan: {
          type: 'string',
          required: false,
          defaultValue: 'free',
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    trustedOrigins: getAllowedOrigins(),
    plugins: [jwt(), bearer()],
  });
}

let authInstance: ReturnType<typeof createBetterAuth> | null = null;

export async function getBetterAuth() {
  if (authInstance) return authInstance;
  const db = await getDb();
  authInstance = createBetterAuth(db);
  return authInstance;
}
