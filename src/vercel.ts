import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { createApiApp } from './app.ts';

/**
 * Vercel entry point. The Express app is created once per warm function instance and reused.
 * It is bundled to api/index.mjs by `npm run build:vercel`.
 */
let appPromise: Promise<Express> | null = null;

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Stripe signs the exact raw bytes, and Vercel may parse the body before Express sees it.
    // Read the raw body ourselves and tell express.raw() it has already been handled.
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/api/payments/webhook') {
      const raw = await readRawBody(req);
      Object.defineProperty(req, 'body', { value: raw, writable: true, configurable: true });
      (req as unknown as { _body?: boolean })._body = true;
    }

    appPromise ??= createApiApp();
    const app = await appPromise;
    app(req as never, res as never);
  } catch (err) {
    appPromise = null;
    console.error('[MentorLagbe API] Failed to start on Vercel:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server failed to start. Check the environment variables in Vercel.' }));
  }
}
