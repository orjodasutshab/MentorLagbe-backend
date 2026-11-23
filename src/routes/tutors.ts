import { Router } from 'express';
import { getDb } from '../db.ts';
import { TOTAL_DAILY_LEVELS, getAllMilestoneBadges } from '../utils/dailyLevels.ts';

const router = Router();

// Public Tutor Directory (strictly non-PII profile fields + approved tuition stats)
router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    const mode = typeof req.query.mode === 'string' ? req.query.mode.trim() : '';
    const plan = typeof req.query.plan === 'string' ? req.query.plan.trim() : '';

    const [tutors, approvedTuitions] = await Promise.all([
      db.users.find((u) => u.role === 'tutor'),
      db.tuitions.find((t) => t.approvalStatus === 'approved' && t.isActive === true),
    ]);

    const tuitionsByEmail = new Map<string, typeof approvedTuitions>();
    for (const t of approvedTuitions) {
      const key = t.tutorEmail.toLowerCase();
      const list = tuitionsByEmail.get(key) || [];
      list.push(t);
      tuitionsByEmail.set(key, list);
    }

    let items = tutors.map((tutor) => {
      const batches = tuitionsByEmail.get(tutor.email.toLowerCase()) || [];
      const subjects = Array.from(new Set(batches.map((b) => b.subject)));
      const modes = Array.from(new Set(batches.map((b) => b.mode)));
      const locations = Array.from(new Set(batches.map((b) => b.location)));
      const allReviews = batches.flatMap((b) => b.reviews || []);
      const avgRating =
        allReviews.length > 0
          ? Number(
              (
                allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
              ).toFixed(1),
            )
          : null;
      const minMonthlyFee =
        batches.length > 0 ? Math.min(...batches.map((b) => b.monthlyFee)) : null;

      return {
        _id: tutor._id,
        name: tutor.name,
        image: tutor.image,
        bio: tutor.bio,
        plan: tutor.plan,
        subjects,
        modes,
        locations,
        minMonthlyFee,
        avgRating,
        reviewCount: allReviews.length,
        tuitionCount: batches.length,
        createdAt: tutor.createdAt,
      };
    });

    if (search) {
      items = items.filter(
        (t) =>
          t.name.toLowerCase().includes(search) ||
          t.bio.toLowerCase().includes(search) ||
          t.subjects.some((s) => s.toLowerCase().includes(search)) ||
          t.locations.some((l) => l.toLowerCase().includes(search)),
      );
    }
    if (subject && subject !== 'All') {
      items = items.filter((t) =>
        t.subjects.some((s) => s.toLowerCase() === subject.toLowerCase()),
      );
    }
    if (mode && mode !== 'All') {
      items = items.filter((t) => t.modes.some((m) => m.toLowerCase() === mode.toLowerCase()));
    }
    if (plan === 'pro') {
      items = items.filter((t) => t.plan === 'pro');
    }

    items.sort((a, b) => {
      if (a.plan !== b.plan) return a.plan === 'pro' ? -1 : 1;
      return b.tuitionCount - a.tuitionCount;
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Public single Tutor profile + approved active tuitions
router.get('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const tutor = await db.users.findOne((u) => u._id === req.params.id && u.role === 'tutor');
    if (!tutor) {
      res.status(404).json({ error: 'Tutor profile not found.' });
      return;
    }

    const [tuitions, dailyDoc] = await Promise.all([
      db.tuitions.find(
        (t) =>
          t.tutorEmail.toLowerCase() === tutor.email.toLowerCase() &&
          t.approvalStatus === 'approved' &&
          t.isActive === true,
      ),
      db.quiz_daily_progress.findOne((p) => p.userId === tutor._id),
    ]);
    tuitions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const reviews = tuitions.flatMap((t) =>
      (t.reviews || []).map((r) => ({
        _id: r._id,
        studentName: r.studentName,
        rating: r.rating,
        comment: r.comment,
        tuitionTitle: t.title,
        createdAt: r.createdAt,
      })),
    );
    const avgRating =
      reviews.length > 0
        ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1))
        : null;

    const tutorTrackBadges = getAllMilestoneBadges('tutor');
    const unlockedSet = new Set(dailyDoc?.unlockedBadgeLevels ?? []);
    const earnedBadges = tutorTrackBadges.filter((b) => unlockedSet.has(b.level)).map((b) => ({
      ...b,
      unlocked: true,
    }));

    res.json({
      tutor: {
        _id: tutor._id,
        name: tutor.name,
        image: tutor.image,
        bannerImage: tutor.bannerImage || '',
        facebookUrl: tutor.facebookUrl || '',
        youtubeUrl: tutor.youtubeUrl || '',
        bio: tutor.bio,
        plan: tutor.plan,
        subjects: Array.from(new Set(tuitions.map((t) => t.subject))),
        modes: Array.from(new Set(tuitions.map((t) => t.mode))),
        avgRating,
        reviewCount: reviews.length,
        tuitionCount: tuitions.length,
        createdAt: tutor.createdAt,
        dailyStats: {
          track: 'tutor',
          completedLevel: dailyDoc?.completedLevel ?? 0,
          streak: dailyDoc?.streak ?? 0,
          totalXp: dailyDoc?.totalXp ?? 0,
          unlockedCount: earnedBadges.length,
          totalLevels: TOTAL_DAILY_LEVELS,
          totalBadges: tutorTrackBadges.length,
        },
        earnedBadges,
      },
      tuitions: tuitions.map(({ tutorEmail: _omitEmail, ...t }) => ({
        ...t,
        tutorId: tutor._id,
        tutorImage: tutor.image,
        tutorPlan: tutor.plan,
        reviews: (t.reviews || []).map((r) => ({
          _id: r._id,
          studentName: r.studentName,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
        })),
      })),
      reviews,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
