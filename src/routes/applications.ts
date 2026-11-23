import { Router } from 'express';
import { z } from 'zod';
import { getDb, generateId, isDuplicateKeyError } from '../db.ts';
import {
  verifyStudent,
  verifyToken,
  verifyTutor,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { createNotification } from '../utils/notifications.ts';

const router = Router();

const createApplicationSchema = z.object({
  tuitionId: z.string().trim().min(1, 'Tuition ID is required'),
  studentPhone: z.string().trim().min(6, 'Phone number is required').max(30),
  preferredSchedule: z.string().trim().min(3, 'Preferred schedule is required').max(120),
  studentNote: z.string().trim().min(5, 'Please include a short learning note').max(1000),
});

const statusUpdateSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

// Student applies to an approved, active tuition
router.post('/', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = createApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid application form data.' });
      return;
    }

    const { tuitionId, studentPhone, preferredSchedule, studentNote } = parsed.data;
    const db = await getDb();

    const tuition = await db.tuitions.findOne(
      (t) => t._id === tuitionId && t.approvalStatus === 'approved' && t.isActive,
    );
    if (!tuition) {
      res.status(404).json({ error: 'This tuition listing is not available for applications.' });
      return;
    }

    const student = req.user!;
    const duplicate = await db.applications.findOne(
      (a) => a.tuitionId === tuition._id && a.studentEmail.toLowerCase() === student.email.toLowerCase(),
    );
    if (duplicate) {
      res.status(409).json({ error: 'You have already applied to this tuition.' });
      return;
    }

    let application;
    try {
    application = await db.applications.insertOne({
      _id: `app_${generateId()}`,
      tuitionId: tuition._id,
      tuitionTitle: tuition.title,
      subject: tuition.subject,
      monthlyFee: tuition.monthlyFee,
      tutorEmail: tuition.tutorEmail,
      tutorName: tuition.tutorName,
      studentName: student.name,
      studentEmail: student.email,
      studentPhone,
      preferredSchedule,
      studentNote,
      status: 'pending',
      appliedAt: new Date().toISOString(),
    });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        res.status(409).json({ error: 'You have already applied to this tuition.' });
        return;
      }
      throw err;
    }

    await createNotification(db, {
      userEmail: tuition.tutorEmail,
      title: 'New tuition application',
      message: `${student.name} applied to "${tuition.title}".`,
      type: 'application',
      link: '/dashboard/tutor/applicants',
    });

    res.status(201).json({ application });
  } catch (err) {
    next(err);
  }
});

// Student views own applications
router.get('/student', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const studentEmail = req.user!.email.toLowerCase();
    const items = await db.applications.find((a) => a.studentEmail.toLowerCase() === studentEmail);
    items.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Student cancels pending application
router.delete('/:id', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const app = await db.applications.findOne((a) => a._id === req.params.id);
    if (!app) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }
    if (app.studentEmail.toLowerCase() !== req.user!.email.toLowerCase()) {
      res.status(403).json({ error: 'You cannot cancel another student’s application.' });
      return;
    }
    if (app.status !== 'pending') {
      res.status(400).json({ error: 'Only pending applications can be cancelled.' });
      return;
    }

    await db.applications.deleteOne((a) => a._id === app._id);
    res.json({ message: 'Application cancelled.' });
  } catch (err) {
    next(err);
  }
});

// Tutor views applicants for their own tuitions
router.get('/tutor', verifyToken, verifyTutor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const tutorEmail = req.user!.email.toLowerCase();
    const [items, students] = await Promise.all([
      db.applications.find((a) => a.tutorEmail.toLowerCase() === tutorEmail),
      db.users.find((u) => u.role === 'student'),
    ]);

    const studentByEmail = new Map(students.map((u) => [u.email.toLowerCase(), u]));
    items.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());

    const enriched = items.map((app) => {
      const student = studentByEmail.get(app.studentEmail.toLowerCase());
      return {
        ...app,
        studentPlan: student?.plan || 'free',
        studentImage: student?.image || '/api/assets/default-avatar.svg',
        studentBio: student?.bio || '',
      };
    });

    res.json({ items: enriched });
  } catch (err) {
    next(err);
  }
});

// Tutor accepts or rejects an application
router.patch('/:id/status', verifyToken, verifyTutor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Status must be accepted or rejected.' });
      return;
    }

    const db = await getDb();
    const app = await db.applications.findOne((a) => a._id === req.params.id);
    if (!app) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }
    if (app.tutorEmail.toLowerCase() !== req.user!.email.toLowerCase()) {
      res.status(403).json({ error: 'Only the owner tutor can manage this application.' });
      return;
    }

    const updated = await db.applications.updateOne(
      (a) => a._id === app._id,
      (a) => ({
        ...a,
        status: parsed.data.status,
      }),
    );

    await createNotification(db, {
      userEmail: app.studentEmail,
      title: `Application ${parsed.data.status}`,
      message: `${req.user!.name} ${parsed.data.status} your application for "${app.tuitionTitle}".`,
      type: 'application',
      link: '/dashboard/student/my-applications',
    });

    res.json({ application: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
