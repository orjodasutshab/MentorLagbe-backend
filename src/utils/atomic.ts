import type { DatabaseHandle } from '../db.ts';
import type { UserDoc } from '../types.ts';

/**
 * Atomically add (delta > 0) or spend (delta < 0) coins.
 * Spending never drops the balance below zero: returns null when funds are insufficient.
 */
export async function adjustCoins(
  db: DatabaseHandle,
  userId: string,
  delta: number,
): Promise<UserDoc | null> {
  return db.users.inc(userId, 'coins', delta, delta < 0 ? { min: 0 } : undefined);
}
