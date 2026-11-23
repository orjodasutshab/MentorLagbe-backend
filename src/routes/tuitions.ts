import { Router } from 'express';
import { z } from 'zod';
import { getDb, generateId, queryApprovedTuitions } from '../db.ts';
import {
  optionalAuth,
  verifyStudent,
  verifyToken,
  verifyTutor,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import type { TuitionDoc, UserDoc } from '../types.ts';

const router = Router();

export function isSafeAssetUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('/src/assets/') ||
    trimmed.startsWith('/api/uploads/') ||
    trimmed.startsWith('/api/assets/')
  ) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const createTuitionSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(140),
  subject: z.string().trim().min(2, 'Subject is required').max(60),
  classLevel: z.string().trim().min(2, 'Class level is required').max(60),
  mode: z.enum(['Online', 'Offline']),
  location: z.string().trim().min(2, 'Location is required').max(100),
  monthlyFee: z.coerce.number().min(500, 'Monthly fee must be at least 500').max(100000),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  description: z.string().trim().min(20, 'Description must be at least 20 characters').max(2000),
  bannerImage: z
    .string()
    .trim()
    .min(1, 'Banner image is required')
    .refine(isSafeAssetUrl, 'Banner image must be a valid image URL.'),
});

const updateTuitionSchema = createTuitionSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(5, 'Please write a brief review comment').max(600),
});

/** Tutors must never receive the reviewing students' email addresses. */
function withoutReviewerEmails<T extends { reviews?: Array<{ studentEmail: string }> }>(t: T) {
  return {
    ...t,
    reviews: (t.reviews || []).map(({ studentEmail: _email, ...review }) => review),
  };
}

const CONTENT_FIELDS = [
  'title',
  'subject',
  'classLevel',
  'mode',
  'location',
  'monthlyFee',
  'daysPerWeek',
  'description',
  'bannerImage',
] as const;

function formatPublicTuition(t: TuitionDoc, tutor?: UserDoc) {
  return {
    ...t,
    tutorId: tutor?._id,
    tutorImage: tutor?.image || t.tutorImage || '/api/assets/default-avatar.svg',
    tutorPlan: tutor?.plan || t.tutorPlan || 'free',
    reviews: (t.reviews || []).map((r) => ({
      _id: r._id,
      studentName: r.studentName,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    })),
  };
}

// Public platform statistics from real database counts
router.get('/stats', async (_req, res, next) => {
  try {
    const db = await getDb();
    const [totalStudents, verifiedTutors, availableTuitions, successfulConnections] =
      await Promise.all([
        db.users.count((u) => u.role === 'student'),
        db.users.count((u) => u.role === 'tutor'),
        db.tuitions.count((t) => t.approvalStatus === 'approved' && t.isActive === true),
        db.applications.count((a) => a.status === 'accepted'),
      ]);

    res.json({
      totalStudents,
      verifiedTutors,
      availableTuitions,
      successfulConnections,
    });
  } catch (err) {
    next(err);
  }
});

// Public browse endpoint with server-side search, filter, sort, and pagination
router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    const classLevel = typeof req.query.classLevel === 'string' ? req.query.classLevel.trim() : '';
    const mode = typeof req.query.mode === 'string' ? req.query.mode.trim() : '';
    const maxFee = req.query.maxFee ? Number(req.query.maxFee) : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : 'latest';
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(24, Math.max(1, Number.parseInt(String(req.query.limit || '9'), 10) || 9));

    const [tutors, queryResult] = await Promise.all([
      db.users.find((u) => u.role === 'tutor'),
      queryApprovedTuitions(db, {
        search,
        subject,
        classLevel,
        mode,
        maxFee: Number.isFinite(maxFee) ? maxFee : undefined,
        sort,
        page,
        limit,
      }),
    ]);

    const tutorByEmail = new Map(tutors.map((u) => [u.email.toLowerCase(), u]));
    const items = queryResult.items.map((t) =>
      formatPublicTuition(t, tutorByEmail.get(t.tutorEmail.toLowerCase())),
    );

    res.json({
      items,
      total: queryResult.total,
      page: queryResult.page,
      limit,
      totalPages: queryResult.totalPages,
    });
  } catch (err) {
    next(err);
  }
});

// Tutor's own tuitions
router.get('/tutor/mine', verifyToken, verifyTutor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const myEmail = req.user!.email.toLowerCase();
    const [tuitions, applications] = await Promise.all([
      db.tuitions.find((t) => t.tutorEmail.toLowerCase() === myEmail),
      db.applications.find((a) => a.tutorEmail.toLowerCase() === myEmail),
    ]);

    tuitions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const items = tuitions.map((t) => ({
      ...withoutReviewerEmails(t),
      applicantCount: applications.filter((a) => a.tuitionId === t._id).length,
      acceptedCount: applications.filter((a) => a.tuitionId === t._id && a.status === 'accepted').length,
    }));

    res.json({
      items,
      totalPosted: tuitions.length,
      plan: req.user!.plan,
      remainingFreePosts: req.user!.plan === 'pro' ? null : Math.max(0, 2 - tuitions.length),
    });
  } catch (err) {
    next(err);
  }
});

// Single tuition details
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const tuition = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!tuition) {
      res.status(404).json({ error: 'Tuition listing not found.' });
      return;
    }

    const isOwner = Boolean(req.user && req.user.email.toLowerCase() === tuition.tutorEmail.toLowerCase());
    const isAdmin = req.user?.role === 'admin';

    if ((tuition.approvalStatus !== 'approved' || !tuition.isActive) && !isOwner && !isAdmin) {
      res.status(404).json({ error: 'Tuition listing is currently unavailable.' });
      return;
    }

    const tutor = await db.users.findOne((u) => u.email.toLowerCase() === tuition.tutorEmail.toLowerCase());

    let hasApplied = false;
    let canReview = false;
    let hasReviewed = false;

    if (req.user?.role === 'student') {
      const studentEmail = req.user.email.toLowerCase();
      const app = await db.applications.findOne(
        (a) => a.tuitionId === tuition._id && a.studentEmail.toLowerCase() === studentEmail,
      );
      hasApplied = Boolean(app);
      hasReviewed = Boolean(tuition.reviews?.some((r) => r.studentEmail.toLowerCase() === studentEmail));
      canReview = Boolean(app && app.status === 'accepted' && !hasReviewed);
    }

    const [relatedCandidates, allTutors] = await Promise.all([
      db.tuitions.find(
        (t) =>
          t._id !== tuition._id &&
          t.approvalStatus === 'approved' &&
          t.isActive &&
          (t.subject.toLowerCase() === tuition.subject.toLowerCase() ||
            t.classLevel.toLowerCase() === tuition.classLevel.toLowerCase()),
      ),
      db.users.find((u) => u.role === 'tutor'),
    ]);

    const tutorMap = new Map(allTutors.map((u) => [u.email.toLowerCase(), u]));
    const relatedTuitions = relatedCandidates
      .slice(0, 3)
      .map((t) => formatPublicTuition(t, tutorMap.get(t.tutorEmail.toLowerCase())));

    res.json({
      tuition: {
        ...formatPublicTuition(tuition, tutor || undefined),
        tutorBio: tutor?.bio || '',
      },
      relatedTuitions,
      viewerState: {
        hasApplied,
        canReview,
        hasReviewed,
        isSaved: Boolean(req.user?.savedTuitionIds?.includes(tuition._id)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Create tuition (Tutor only, enforces Free max 2 tuitions)
router.post('/', verifyToken, verifyTutor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = createTuitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid tuition details.' });
      return;
    }

    const db = await getDb();
    const tutor = req.user!;
    const myTuitions = await db.tuitions.find(
      (t) => t.tutorEmail.toLowerCase() === tutor.email.toLowerCase(),
    );

    if (tutor.plan !== 'pro' && myTuitions.length >= 2) {
      res.status(403).json({
        error:
          'Free Tutor accounts can post up to 2 tuition listings. Upgrade to Pro Tutor for unlimited posts.',
        code: 'POST_LIMIT_REACHED',
      });
      return;
    }

    const created = await db.tuitions.insertOne({
      _id: `tui_${generateId()}`,
      ...parsed.data,
      tutorName: tutor.name,
      tutorEmail: tutor.email,
      tutorImage: tutor.image,
      tutorPlan: tutor.plan,
      approvalStatus: 'pending',
      isActive: true,
      reviews: [],
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ tuition: withoutReviewerEmails(created) });
  } catch (err) {
    next(err);
  }
});

// Update tuition (Owner Tutor only)
router.patch('/:id', verifyToken, verifyTutor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = updateTuitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload.' });
      return;
    }

    const db = await getDb();
    const existing = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Tuition listing not found.' });
      return;
    }
    if (existing.tutorEmail.toLowerCase() !== req.user!.email.toLowerCase()) {
      res.status(403).json({ error: 'You do not have permission to edit this tuition.' });
      return;
    }

    if (parsed.data.isActive === true && existing.adminDisabled) {
      res.status(403).json({
        error: 'This listing was deactivated by an administrator and cannot be re-activated by the tutor.',
      });
      return;
    }

    // Editing the public content of an approved listing sends it back to moderation.
    const contentChanged = CONTENT_FIELDS.some(
      (field) => parsed.data[field] !== undefined && parsed.data[field] !== existing[field],
    );
    const needsReview = contentChanged && existing.approvalStatus === 'approved';

    const updated = await db.tuitions.updateOne(
      (t) => t._id === existing._id,
      (t) => ({
        ...t,
        ...parsed.data,
        ...(needsReview ? { approvalStatus: 'pending' as const } : {}),
      }),
    );

    res.json({ tuition: updated ? withoutReviewerEmails(updated) : updated, sentForReview: needsReview });
  } catch (err) {
    next(err);
  }
});

// Delete tuition (Owner Tutor only)
router.delete('/:id', verifyToken, verifyTutor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Tuition listing not found.' });
      return;
    }
    if (existing.tutorEmail.toLowerCase() !== req.user!.email.toLowerCase()) {
      res.status(403).json({ error: 'You do not have permission to delete this tuition.' });
      return;
    }

    await db.tuitions.deleteOne((t) => t._id === existing._id);
    await db.applications.deleteMany((a) => a.tuitionId === existing._id);

    res.json({ message: 'Tuition deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

// Verified student review (Only students with accepted application can review)
router.post('/:id/reviews', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review data.' });
      return;
    }

    const db = await getDb();
    const tuition = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!tuition) {
      res.status(404).json({ error: 'Tuition listing not found.' });
      return;
    }

    const studentEmail = req.user!.email.toLowerCase();
    const acceptedApp = await db.applications.findOne(
      (a) =>
        a.tuitionId === tuition._id &&
        a.studentEmail.toLowerCase() === studentEmail &&
        a.status === 'accepted',
    );
    if (!acceptedApp) {
      res.status(403).json({ error: 'Only students with an accepted application can review this tuition.' });
      return;
    }

    if (tuition.reviews?.some((r) => r.studentEmail.toLowerCase() === studentEmail)) {
      res.status(409).json({ error: 'You have already reviewed this tuition.' });
      return;
    }

    const newReview = {
      _id: `rev_${generateId()}`,
      studentName: req.user!.name,
      studentEmail: req.user!.email,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      createdAt: new Date().toISOString(),
    };

    const updated = await db.tuitions.updateOne(
      (t) => t._id === tuition._id,
      (t) => ({
        ...t,
        reviews: [newReview, ...(t.reviews || [])],
      }),
    );

    res.status(201).json({
      review: {
        _id: newReview._id,
        studentName: newReview.studentName,
        rating: newReview.rating,
        comment: newReview.comment,
        createdAt: newReview.createdAt,
      },
      reviews: (updated?.reviews || []).map((r) => ({
        _id: r._id,
        studentName: r.studentName,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
