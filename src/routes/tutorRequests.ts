import { Router } from 'express';
import { z } from 'zod';
import { generateId, getDb } from '../db.ts';
import {
  verifyStudent,
  verifyToken,
  verifyTutor,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { createNotification } from '../utils/notifications.ts';

const router = Router();

const createRequestSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(140),
  subject: z.string().trim().min(2).max(60),
  classLevel: z.string().trim().min(2).max(60),
  mode: z.enum(['Online', 'Offline']),
  location: z.string().trim().min(2).max(100),
  budgetMonthly: z.coerce.number().min(500).max(100000),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  scheduleNote: z.string().trim().min(3).max(160),
  description: z.string().trim().min(15, 'Description must be at least 15 characters').max(1000),
});

const respondSchema = z.object({
  proposedFee: z.coerce.number().min(500).max(100000),
  pitch: z.string().trim().min(10, 'Write a brief teaching proposal').max(600),
});

// Public / Tutor view of open tutor requests (student email redacted)
router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    const mode = typeof req.query.mode === 'string' ? req.query.mode.trim() : '';

    let items = await db.tutor_requests.find((r) => r.status === 'open');
    if (search) {
      items = items.filter(
        (r) =>
          r.title.toLowerCase().includes(search) ||
          r.subject.toLowerCase().includes(search) ||
          r.location.toLowerCase().includes(search) ||
          r.description.toLowerCase().includes(search),
      );
    }
    if (subject && subject !== 'All') {
      items = items.filter((r) => r.subject.toLowerCase() === subject.toLowerCase());
    }
    if (mode && mode !== 'All') {
      items = items.filter((r) => r.mode.toLowerCase() === mode.toLowerCase());
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({
      // Tutor pitches and fees are private between the tutor and the student who asked.
      items: items.map(({ studentEmail: _omit, responses, ...safe }) => ({
        ...safe,
        responsesCount: responses.length,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Student views their own posted tutor requests
router.get('/mine', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const items = await db.tutor_requests.find(
      (r) => r.studentEmail.toLowerCase() === req.user!.email.toLowerCase(),
    );
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Student creates a custom tutor request
router.post('/', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid tutor request.' });
      return;
    }

    const db = await getDb();
    const created = await db.tutor_requests.insertOne({
      _id: `treq_${generateId()}`,
      studentId: req.user!._id,
      studentName: req.user!.name,
      studentEmail: req.user!.email,
      ...parsed.data,
      status: 'open',
      responses: [],
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ request: created });
  } catch (err) {
    next(err);
  }
});

// Tutor responds with a teaching pitch
router.post('/:id/respond', verifyToken, verifyTutor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = respondSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid response payload.' });
      return;
    }

    const db = await getDb();
    const target = await db.tutor_requests.findOne((r) => r._id === req.params.id);
    if (!target || target.status !== 'open') {
      res.status(404).json({ error: 'This tutor request is no longer open.' });
      return;
    }
    if (target.responses.some((resp) => resp.tutorId === req.user!._id)) {
      res.status(409).json({ error: 'You have already responded to this tutor request.' });
      return;
    }

    const newResponse = {
      _id: `tresp_${generateId()}`,
      tutorId: req.user!._id,
      tutorName: req.user!.name,
      tutorImage: req.user!.image,
      tutorPlan: req.user!.plan,
      proposedFee: parsed.data.proposedFee,
      pitch: parsed.data.pitch,
      createdAt: new Date().toISOString(),
    };

    const updated = await db.tutor_requests.updateOne(
      (r) => r._id === target._id,
      (r) => ({ ...r, responses: [...r.responses, newResponse] }),
    );

    await createNotification(db, {
      userEmail: target.studentEmail,
      title: 'New tutor response to your request',
      message: `${req.user!.name} responded to "${target.title}".`,
      type: 'request',
      link: '/dashboard/student/tutor-requests',
    });

    res.status(201).json({ request: updated });
  } catch (err) {
    next(err);
  }
});

// Student updates request status (open / matched / closed)
router.patch('/:id/status', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const schema = z.object({ status: z.enum(['open', 'matched', 'closed']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }

    const db = await getDb();
    const existing = await db.tutor_requests.findOne((r) => r._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Tutor request not found.' });
      return;
    }
    const isOwner = existing.studentEmail.toLowerCase() === req.user!.email.toLowerCase();
    if (!isOwner && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You cannot modify another student’s tutor request.' });
      return;
    }

    const updated = await db.tutor_requests.updateOne(
      (r) => r._id === existing._id,
      (r) => ({ ...r, status: parsed.data.status }),
    );
    res.json({ request: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
