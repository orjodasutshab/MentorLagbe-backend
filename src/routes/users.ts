import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.ts';
import {
  sanitizeUser,
  verifyStudent,
  verifyToken,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { isSafeAssetUrl } from './tuitions.ts';
import {
  TOTAL_DAILY_LEVELS,
  getAllMilestoneBadges,
  getDhakaDateKey,
  getPreviousDhakaDateKey,
  resolveDailyTrack,
} from '../utils/dailyLevels.ts';

const router = Router();

router.get('/my-profile-summary', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const user = req.user!;
    const track = resolveDailyTrack(user.role);
    const trackBadges = getAllMilestoneBadges(track);
    const todayKey = getDhakaDateKey();
    const prevKey = getPreviousDhakaDateKey(todayKey);

    const [dailyDoc, attempts, tutorTuitions, studentApps] = await Promise.all([
      db.quiz_daily_progress.findOne((p) => p.userId === user._id),
      db.quiz_attempts.find((a) => a.userId === user._id),
      user.role === 'tutor'
        ? db.tuitions.find((t) => t.tutorEmail.toLowerCase() === user.email.toLowerCase())
        : Promise.resolve([]),
      user.role === 'student'
        ? db.applications.find((a) => a.studentEmail.toLowerCase() === user.email.toLowerCase())
        : Promise.resolve([]),
    ]);

    const unlockedSet = new Set(dailyDoc?.unlockedBadgeLevels ?? []);
    const activeStreak =
      dailyDoc && (dailyDoc.lastCompletedDate === todayKey || dailyDoc.lastCompletedDate === prevKey)
        ? dailyDoc.streak
        : 0;

    const badges = trackBadges.map((b) => ({
      ...b,
      unlocked: unlockedSet.has(b.level),
    }));

    attempts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      user: sanitizeUser(user),
      track,
      dailyStats: {
        track,
        totalLevels: TOTAL_DAILY_LEVELS,
        completedLevel: dailyDoc?.completedLevel ?? 0,
        lastCompletedDate: dailyDoc?.lastCompletedDate ?? null,
        completedToday: Boolean(dailyDoc && dailyDoc.lastCompletedDate === todayKey),
        streak: activeStreak,
        totalXp: dailyDoc?.totalXp ?? 0,
        unlockedCount: unlockedSet.size,
        totalBadges: trackBadges.length,
      },
      badges,
      recentAttempts: attempts.slice(0, 8),
      roleSummary:
        user.role === 'tutor'
          ? {
              approvedTuitions: tutorTuitions.filter((t) => t.approvalStatus === 'approved' && t.isActive),
              totalTuitionsCount: tutorTuitions.length,
            }
          : user.role === 'student'
            ? {
                applicationsCount: studentApps.length,
                acceptedCount: studentApps.filter((a) => a.status === 'accepted').length,
                savedCount: (user.savedTuitionIds || []).length,
              }
            : {},
    });
  } catch (err) {
    next(err);
  }
});

function isSafeHttpUrl(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: z.string().trim().max(30).optional(),
  bio: z.string().trim().max(500).optional(),
  image: z
    .string()
    .trim()
    .min(1, 'Profile image URL is required')
    .refine(isSafeAssetUrl, 'Invalid profile image URL.'),
  bannerImage: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || isSafeAssetUrl(val), 'Invalid banner image URL.'),
  facebookUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .refine((val) => !val || isSafeHttpUrl(val), 'Facebook link must start with https:// or http://'),
  youtubeUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .refine((val) => !val || isSafeHttpUrl(val), 'YouTube link must start with https:// or http://'),
});

router.patch('/profile', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile data.' });
      return;
    }

    const db = await getDb();
    const updated = await db.users.updateOne(
      (u) => u._id === req.user!._id,
      (u) => ({
        ...u,
        name: parsed.data.name,
        phone: parsed.data.phone !== undefined ? parsed.data.phone : u.phone,
        bio: parsed.data.bio !== undefined ? parsed.data.bio : u.bio,
        image: parsed.data.image,
        bannerImage:
          parsed.data.bannerImage !== undefined ? parsed.data.bannerImage : u.bannerImage || '',
        facebookUrl:
          parsed.data.facebookUrl !== undefined
            ? parsed.data.facebookUrl.trim()
            : u.facebookUrl || '',
        youtubeUrl:
          parsed.data.youtubeUrl !== undefined
            ? parsed.data.youtubeUrl.trim()
            : u.youtubeUrl || '',
      }),
    );

    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (updated.role === 'tutor') {
      await db.tuitions.updateMany(
        (t) => t.tutorEmail.toLowerCase() === updated.email.toLowerCase(),
        (t) => ({
          ...t,
          tutorName: updated.name,
          tutorImage: updated.image,
        }),
      );
    }

    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});

// Student saved / bookmarked tuitions
router.get('/saved-tuitions', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const savedIds = req.user!.savedTuitionIds || [];
    const items = await db.tuitions.find(
      (t) => savedIds.includes(t._id) && t.approvalStatus === 'approved' && t.isActive,
    );
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Toggle bookmark — enforces max 5 bookmarks for Free Students, unlimited for Pro Students
router.post('/saved-tuitions/:tuitionId', verifyToken, verifyStudent, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const { tuitionId } = req.params;
    const tuition = await db.tuitions.findOne(
      (t) => t._id === tuitionId && t.approvalStatus === 'approved' && t.isActive,
    );
    if (!tuition) {
      res.status(404).json({ error: 'Tuition not found.' });
      return;
    }

    // Ignore bookmarks whose tuition was deleted/rejected/deactivated so they don't eat the free limit.
    const storedSaved = req.user!.savedTuitionIds || [];
    const stillAvailable = new Set(
      (
        await db.tuitions.find(
          (t) => storedSaved.includes(t._id) && t.approvalStatus === 'approved' && t.isActive,
        )
      ).map((t) => t._id),
    );
    const currentSaved = storedSaved.filter((id) => stillAvailable.has(id));
    const exists = currentSaved.includes(tuitionId);

    if (!exists && req.user!.plan !== 'pro' && currentSaved.length >= 5) {
      res.status(403).json({
        error:
          'Free Student accounts can bookmark up to 5 tuitions. Upgrade to Pro Student for unlimited bookmarks.',
        code: 'BOOKMARK_LIMIT_REACHED',
      });
      return;
    }

    const nextSaved = exists
      ? currentSaved.filter((id) => id !== tuitionId)
      : [...currentSaved, tuitionId];

    const updated = await db.users.updateOne(
      (u) => u._id === req.user!._id,
      (u) => ({
        ...u,
        savedTuitionIds: nextSaved,
      }),
    );

    res.json({
      saved: !exists,
      savedTuitionIds: updated?.savedTuitionIds || nextSaved,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
