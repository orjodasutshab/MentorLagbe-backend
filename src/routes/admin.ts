import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.ts';
import {
  sanitizeUser,
  verifyAdmin,
  verifyToken,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { createNotification } from '../utils/notifications.ts';

const router = Router();

router.use(verifyToken, verifyAdmin);

const updateRoleSchema = z.object({
  role: z.enum(['student', 'tutor', 'admin']),
});

const updateTuitionModerationSchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  isActive: z.boolean().optional(),
  rejectionReason: z.string().trim().max(400).optional(),
});

// Admin overview metrics
router.get('/overview', async (_req, res, next) => {
  try {
    const db = await getDb();
    const [users, tuitions, payments, applications, customQuizzes] = await Promise.all([
      db.users.findAll(),
      db.tuitions.findAll(),
      db.payments.findAll(),
      db.applications.findAll(),
      db.custom_quizzes.findAll(),
    ]);

    const totalUsers = users.length;
    const totalStudents = users.filter((u) => u.role === 'student').length;
    const totalTutors = users.filter((u) => u.role === 'tutor').length;
    const pendingTuitions = tuitions.filter((t) => t.approvalStatus === 'pending').length;
    const approvedTuitions = tuitions.filter((t) => t.approvalStatus === 'approved').length;
    const pendingQuizzes = customQuizzes.filter((q) => q.approvalStatus === 'pending').length;
    const totalRevenue = payments
      .filter((p) => p.paymentStatus === 'paid')
      .reduce((sum, p) => sum + p.amount, 0);

    const recentPayments = [...payments]
      .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
      .slice(0, 5);

    res.json({
      totalUsers,
      totalStudents,
      totalTutors,
      pendingTuitions,
      approvedTuitions,
      pendingQuizzes,
      totalApplications: applications.length,
      totalRevenue,
      recentPayments,
    });
  } catch (err) {
    next(err);
  }
});

// Manage Users
router.get('/users', async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const role = typeof req.query.role === 'string' ? req.query.role.trim() : '';

    let users = await db.users.findAll();
    if (search) {
      users = users.filter(
        (u) => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search),
      );
    }
    if (role && role !== 'all') {
      users = users.filter((u) => u.role === role);
    }

    users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: users.map(sanitizeUser) });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id/role', async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Role must be student, tutor, or admin.' });
      return;
    }

    if (req.params.id === req.user!._id && parsed.data.role !== 'admin') {
      res.status(400).json({ error: 'You cannot revoke your own admin privileges.' });
      return;
    }

    const db = await getDb();
    const updated = await db.users.updateOne(
      (u) => u._id === req.params.id,
      (u) => ({ ...u, role: parsed.data.role }),
    );
    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.params.id === req.user!._id) {
      res.status(400).json({ error: 'You cannot delete your own admin account.' });
      return;
    }

    const db = await getDb();
    const target = await db.users.findOne((u) => u._id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    if (target.role === 'admin') {
      res.status(403).json({ error: 'Admin accounts cannot be deleted here.' });
      return;
    }

    await db.users.deleteOne((u) => u._id === target._id);
    await db.auth_sessions.deleteMany((s) => s.userId === target._id);
    await Promise.all([
      db.messages.deleteMany((m) => m.senderId === target._id || m.recipientId === target._id),
      db.notifications.deleteMany((n) => n.userEmail.toLowerCase() === target.email.toLowerCase()),
      db.quiz_attempts.deleteMany((a) => a.userId === target._id),
      db.quiz_daily_progress.deleteMany((p) => p.userId === target._id),
      db.tutor_requests.deleteMany((r) => r.studentId === target._id),
    ]);
    if (target.role === 'tutor') {
      await db.tuitions.deleteMany((t) => t.tutorEmail.toLowerCase() === target.email.toLowerCase());
      await db.applications.deleteMany(
        (a) => a.tutorEmail.toLowerCase() === target.email.toLowerCase(),
      );
    } else if (target.role === 'student') {
      await db.applications.deleteMany(
        (a) => a.studentEmail.toLowerCase() === target.email.toLowerCase(),
      );
    }

    res.json({ message: 'User account removed.' });
  } catch (err) {
    next(err);
  }
});

// Moderate Tuitions
router.get('/tuitions', async (req, res, next) => {
  try {
    const db = await getDb();
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    let tuitions = await db.tuitions.findAll();
    if (status && status !== 'all') {
      tuitions = tuitions.filter((t) => t.approvalStatus === status);
    }
    tuitions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: tuitions });
  } catch (err) {
    next(err);
  }
});

router.patch('/tuitions/:id', async (req, res, next) => {
  try {
    const parsed = updateTuitionModerationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid moderation payload.' });
      return;
    }

    const db = await getDb();
    const existing = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Tuition listing not found.' });
      return;
    }

    const updated = await db.tuitions.updateOne(
      (t) => t._id === req.params.id,
      (t) => ({
        ...t,
        ...(parsed.data.approvalStatus ? { approvalStatus: parsed.data.approvalStatus } : {}),
        ...(typeof parsed.data.isActive === 'boolean'
          ? { isActive: parsed.data.isActive, adminDisabled: parsed.data.isActive === false }
          : {}),
        ...(typeof parsed.data.rejectionReason === 'string'
          ? { rejectionReason: parsed.data.rejectionReason }
          : {}),
      }),
    );

    if (parsed.data.approvalStatus && parsed.data.approvalStatus !== existing.approvalStatus) {
      await createNotification(db, {
        userEmail: existing.tutorEmail,
        title: `Tuition ${parsed.data.approvalStatus}`,
        message:
          parsed.data.approvalStatus === 'approved'
            ? `"${existing.title}" has been approved and is now live.`
            : `"${existing.title}" was marked ${parsed.data.approvalStatus}.`,
        type: 'moderation',
        link: '/dashboard/tutor/my-tuitions',
      });
    }

    res.json({ tuition: updated });
  } catch (err) {
    next(err);
  }
});

// Stripe Payment Transactions Ledger
router.get('/transactions', async (_req, res, next) => {
  try {
    const db = await getDb();
    const items = await db.payments.findAll();
    items.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
