import { Router } from 'express';
import { getDb } from '../db.ts';
import { verifyToken, type AuthenticatedRequest } from '../middleware/auth.ts';

const router = Router();
router.use(verifyToken);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const email = req.user!.email.toLowerCase();
    const items = await db.notifications.find((n) => n.userEmail.toLowerCase() === email);
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unreadCount = items.filter((n) => !n.read).length;
    res.json({ items: items.slice(0, 25), unreadCount });
  } catch (err) {
    next(err);
  }
});

router.patch('/read-all', async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const email = req.user!.email.toLowerCase();
    await db.notifications.updateMany(
      (n) => n.userEmail.toLowerCase() === email && !n.read,
      (n) => ({ ...n, read: true }),
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const email = req.user!.email.toLowerCase();
    const target = await db.notifications.findOne((n) => n._id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    if (target.userEmail.toLowerCase() !== email) {
      res.status(403).json({ error: 'Cannot update another user’s notification.' });
      return;
    }
    const updated = await db.notifications.updateOne(
      (n) => n._id === target._id,
      (n) => ({ ...n, read: true }),
    );
    res.json({ notification: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
