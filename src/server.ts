import 'dotenv/config';
import { createApiApp } from './app.ts';
import { closeDb } from './db.ts';

async function startStandaloneServer() {
  const app = await createApiApp();
  const port = Number(process.env.PORT) || 5000;

  const httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`[MentorLagbe API] Listening on http://localhost:${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[MentorLagbe API] Received ${signal}. Shutting down gracefully...`);
    httpServer.close(async () => {
      try {
        await closeDb();
      } catch (err) {
        console.error('[MentorLagbe API] Error closing database:', err);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startStandaloneServer().catch((err) => {
  console.error('[MentorLagbe API] Failed to start server:', err);
  process.exit(1);
});
