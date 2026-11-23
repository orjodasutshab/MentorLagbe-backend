import { Router } from 'express';
import { z } from 'zod';
import { generateId, getDb } from '../db.ts';
import { adjustCoins } from '../utils/atomic.ts';
import {
  optionalAuth,
  verifyAdmin,
  verifyToken,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { isSafeAssetUrl } from './tuitions.ts';

const router = Router();

function isSafeResourceLink(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const createResourceSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(140),
  category: z.enum(['Formula Sheets', 'Lecture Notes', 'Exam Guides', 'Coding Labs', 'Past Papers']),
  subject: z.string().trim().min(2, 'Subject is required').max(60),
  classLevel: z.string().trim().min(2, 'Class level is required').max(60),
  summary: z.string().trim().min(15, 'Summary must be at least 15 characters').max(320),
  contentPreview: z.string().trim().min(20, 'Preview notes must be at least 20 characters').max(2000),
  thumbnailUrl: z
    .string()
    .trim()
    .min(1)
    .refine(isSafeAssetUrl, 'Invalid thumbnail image URL.'),
  resourceUrl: z
    .string()
    .trim()
    .min(1)
    .refine(isSafeResourceLink, 'Invalid resource link.'),
  accessLevel: z.enum(['free', 'pro']).default('free'),
});

// Public approved study resources
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const hasProAccess = Boolean(req.user && (req.user.plan === 'pro' || req.user.role === 'admin'));
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    const access = typeof req.query.access === 'string' ? req.query.access.trim() : '';

    let items = await db.resources.find((r) => r.approvalStatus === 'approved');
    if (search) {
      items = items.filter(
        (r) =>
          r.title.toLowerCase().includes(search) ||
          r.subject.toLowerCase().includes(search) ||
          r.summary.toLowerCase().includes(search) ||
          r.authorName.toLowerCase().includes(search),
      );
    }
    if (category && category !== 'All') {
      items = items.filter((r) => r.category.toLowerCase() === category.toLowerCase());
    }
    if (subject && subject !== 'All') {
      items = items.filter((r) => r.subject.toLowerCase() === subject.toLowerCase());
    }
    if (access === 'free' || access === 'pro') {
      items = items.filter((r) => r.accessLevel === access);
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({
      items: items.map(({ authorEmail: _omit, downloaderIds: _dl, ...safe }) => {
        // Pro links are only handed out by the /download endpoint, never in the public list.
        if (safe.accessLevel === 'pro' && !hasProAccess) {
          const { resourceUrl: _hidden, ...withoutLink } = safe;
          return withoutLink;
        }
        return safe;
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Tutor views own published resources
router.get('/mine', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user!.role !== 'tutor' && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only Tutors and Admins manage study resources.' });
      return;
    }
    const db = await getDb();
    const items = await db.resources.find(
      (r) => r.authorEmail.toLowerCase() === req.user!.email.toLowerCase(),
    );
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: items.map(({ downloaderIds: _dl, ...safe }) => safe) });
  } catch (err) {
    next(err);
  }
});

// Tutor or Admin creates a study resource
router.post('/', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user!.role !== 'tutor' && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only Tutors and Admins can publish study resources.' });
      return;
    }
    const parsed = createResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid resource data.' });
      return;
    }

    const db = await getDb();
    // Pro tutors skip moderation, but only for a few resources per day so the perk can't be spammed.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentOwn = await db.resources.count(
      (r) => r.authorId === req.user!._id && new Date(r.createdAt).getTime() >= dayAgo,
    );
    const autoApprove =
      req.user!.role === 'admin' || (req.user!.plan === 'pro' && recentOwn < 3);
    const created = await db.resources.insertOne({
      _id: `res_${generateId()}`,
      ...parsed.data,
      authorId: req.user!._id,
      authorName: req.user!.name,
      authorEmail: req.user!.email,
      approvalStatus: autoApprove ? 'approved' : 'pending',
      approvalCoinCredited: autoApprove,
      downloads: 0,
      createdAt: new Date().toISOString(),
    });
    if (autoApprove) {
      await adjustCoins(db, req.user!._id, 25);
    }
    res.status(201).json({ resource: created });
  } catch (err) {
    next(err);
  }
});

// Track download / access (Pro resources require signed-in Pro plan; credits author +5 coins)
router.post('/:id/download', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const resource = await db.resources.findOne(
      (r) => r._id === req.params.id && r.approvalStatus === 'approved',
    );
    if (!resource) {
      res.status(404).json({ error: 'Study resource not found.' });
      return;
    }

    if (resource.accessLevel === 'pro') {
      if (!req.user) {
        res.status(401).json({ error: 'Sign in with a Pro plan to unlock Pro study packs.' });
        return;
      }
      if (req.user.plan !== 'pro' && req.user.role !== 'admin') {
        res.status(403).json({
          error: 'Upgrade to Pro to download Pro study packs.',
          code: 'PRO_PLAN_REQUIRED',
        });
        return;
      }
    }

    // Only signed-in users count as downloads, and each user counts once per resource.
    // This stops anonymous or repeated calls from inflating downloads and farming author coins.
    if (req.user) {
      const firstDownload = await db.resources.claimOnce(resource._id, 'downloaderIds', req.user._id);
      if (firstDownload) {
        await db.resources.inc(resource._id, 'downloads', 1);
        if (req.user._id !== resource.authorId) {
          await adjustCoins(db, resource.authorId, 5);
        }
      }
    }
    const updated = await db.resources.findById(resource._id);
    res.json({
      downloads: updated?.downloads ?? resource.downloads + 1,
      resourceUrl: resource.resourceUrl,
    });
  } catch (err) {
    next(err);
  }
});

// Admin list all resources
router.get('/admin/all', verifyToken, verifyAdmin, async (_req, res, next) => {
  try {
    const db = await getDb();
    const items = await db.resources.findAll();
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Admin moderate resource
router.patch('/:id/moderation', verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const schema = z.object({ approvalStatus: z.enum(['pending', 'approved', 'rejected']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid approval status.' });
      return;
    }

    const db = await getDb();
    const existing = await db.resources.findOne((r) => r._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Resource not found.' });
      return;
    }

    const shouldCreditApprovalCoin =
      parsed.data.approvalStatus === 'approved' && !existing.approvalCoinCredited;

    let updated;
    let creditNow = false;
    if (shouldCreditApprovalCoin) {
      // Compare-and-swap on the credited flag so a double click can't pay the 25 coins twice.
      creditNow = await db.resources.replaceIfUnchanged(
        existing._id,
        { approvalCoinCredited: existing.approvalCoinCredited },
        { ...existing, approvalStatus: parsed.data.approvalStatus, approvalCoinCredited: true },
      );
      updated = await db.resources.findById(existing._id);
    } else {
      updated = await db.resources.updateOne(
        (r) => r._id === req.params.id,
        (r) => ({ ...r, approvalStatus: parsed.data.approvalStatus }),
      );
    }

    if (creditNow) {
      await adjustCoins(db, existing.authorId, 25);
    }

    res.json({ resource: updated });
  } catch (err) {
    next(err);
  }
});

// Delete resource (owner tutor or admin)
router.delete('/:id', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.resources.findOne((r) => r._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Resource not found.' });
      return;
    }
    const isOwner = existing.authorEmail.toLowerCase() === req.user!.email.toLowerCase();
    if (!isOwner && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You cannot delete another author’s resource.' });
      return;
    }
    await db.resources.deleteOne((r) => r._id === existing._id);
    res.json({ message: 'Resource deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;
