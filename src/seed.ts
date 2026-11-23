import 'dotenv/config';
import { closeDb, getDb } from './db.ts';
import { seedDatabaseIfEmpty } from './utils/seedData.ts';
import { ensureExtrasSeeded } from './utils/extrasSeed.ts';
import { extraFeaturesEnabled } from './config/features.ts';

async function runSeed() {
  const db = await getDb();
  const forceReset = process.argv.includes('--reset');

  if (forceReset) {
    await Promise.all([
      db.users.deleteMany(() => true),
      db.tuitions.deleteMany(() => true),
      db.applications.deleteMany(() => true),
      db.payments.deleteMany(() => true),
      db.auth_sessions.deleteMany(() => true),
      db.resources.deleteMany(() => true),
      db.tutor_requests.deleteMany(() => true),
      db.messages.deleteMany(() => true),
      db.notifications.deleteMany(() => true),
      db.quiz_attempts.deleteMany(() => true),
      db.quiz_daily_progress.deleteMany(() => true),
    ]);
  }

  const seeded = await seedDatabaseIfEmpty(db);
  if (extraFeaturesEnabled()) await ensureExtrasSeeded(db);
  if (!seeded && !forceReset) {
    console.log('[Seed] Database already contains core data. Ensured extra collections are seeded.');
  }
  await closeDb();
}

runSeed().catch((err) => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
