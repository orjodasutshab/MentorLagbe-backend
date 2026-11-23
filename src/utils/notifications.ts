import { generateId, type DatabaseHandle } from '../db.ts';
import type { NotificationDoc } from '../types.ts';
import { extraFeaturesEnabled } from '../config/features.ts';

export async function createNotification(
  db: DatabaseHandle,
  params: {
    userEmail: string;
    title: string;
    message: string;
    type: NotificationDoc['type'];
    link: string;
  },
): Promise<NotificationDoc | null> {
  // Notifications live in an extra collection, so they are skipped in strict 4-collection mode.
  if (!extraFeaturesEnabled()) return null;
  const safeLink = params.link.startsWith('/') ? params.link : '/';
  return db.notifications.insertOne({
    _id: `ntf_${generateId()}`,
    userEmail: params.userEmail.toLowerCase(),
    title: params.title.slice(0, 120),
    message: params.message.slice(0, 400),
    type: params.type,
    link: safeLink,
    read: false,
    createdAt: new Date().toISOString(),
  });
}
