import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { generateId, getDb, isDuplicateKeyError, type DatabaseHandle } from '../db.ts';
import { adjustCoins } from '../utils/atomic.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import {
  optionalAuth,
  verifyAdmin,
  verifyToken,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import type {
  CustomQuizDoc,
  CustomQuizQuestionDoc,
  DailyQuizProgressDoc,
  DailyTrack,
} from '../types.ts';
import {
  DAILY_PASSING_SCORE,
  TOTAL_DAILY_LEVELS,
  generateDailyLevelQuiz,
  getAllMilestoneBadges,
  getDhakaDateKey,
  getPreviousDhakaDateKey,
  resolveDailyTrack,
  type DailyBadgeDef,
} from '../utils/dailyLevels.ts';
import { createNotification } from '../utils/notifications.ts';

interface QuizQuestionDef {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface QuizDef {
  _id: string;
  title: string;
  subject: string;
  level: string;
  durationMinutes: number;
  description: string;
  questions: QuizQuestionDef[];
}

const QUIZZES: QuizDef[] = [
  {
    _id: 'quiz_math_calculus',
    title: 'HSC Higher Math: Limits, Differentiation & Integrals',
    subject: 'Mathematics',
    level: 'HSC / Admission',
    durationMinutes: 8,
    description: 'Assess your calculus fluency with 5 curated board & engineering-track questions.',
    questions: [
      {
        id: 'm1',
        prompt: 'What is the derivative of f(x) = ln(3x^2 + 1) with respect to x?',
        options: ['6x / (3x^2 + 1)', '1 / (3x^2 + 1)', '6x ln(3x^2 + 1)', '3x / (3x^2 + 1)'],
        correctIndex: 0,
        explanation: 'By the chain rule, d/dx[ln(u)] = u\'/u, giving 6x / (3x^2 + 1).',
      },
      {
        id: 'm2',
        prompt: 'Evaluate the limit: lim (x -> 0) [sin(5x) / (2x)].',
        options: ['0', '5/2', '2/5', '1'],
        correctIndex: 1,
        explanation: 'Using lim (u->0) sin(u)/u = 1, rewrite as (5/2) * [sin(5x)/(5x)] -> 5/2.',
      },
      {
        id: 'm3',
        prompt: 'What is the value of the definite integral ∫₀¹ (3x² + 2x) dx?',
        options: ['1', '2', '3', '5'],
        correctIndex: 1,
        explanation: 'Antiderivative is x³ + x². Evaluating from 0 to 1 gives (1 + 1) - 0 = 2.',
      },
      {
        id: 'm4',
        prompt: 'At a local extremum where f\'(c) = 0 and f\'\'(c) < 0, the function has a:',
        options: ['Local minimum', 'Local maximum', 'Point of inflection', 'Vertical asymptote'],
        correctIndex: 1,
        explanation: 'Negative second derivative means concave downward, indicating a local maximum.',
      },
      {
        id: 'm5',
        prompt: 'What is ∫ e^(2x) dx?',
        options: ['2e^(2x) + C', 'e^(2x) + C', '(1/2)e^(2x) + C', 'e^(x^2) + C'],
        correctIndex: 2,
        explanation: 'Substituting u = 2x yields du = 2dx, so the integral is (1/2)e^(2x) + C.',
      },
    ],
  },
  {
    _id: 'quiz_physics_mechanics',
    title: 'Physics Mechanics, Work-Energy & Circular Motion',
    subject: 'Physics',
    level: 'HSC / A-Level',
    durationMinutes: 8,
    description: 'Test core conceptual clarity across kinematics, momentum, and rotational motion.',
    questions: [
      {
        id: 'p1',
        prompt: 'If a projectile is launched at 45° with speed v, at the highest point its kinetic energy is what fraction of initial KE?',
        options: ['0', '1/4', '1/2', '3/4'],
        correctIndex: 2,
        explanation: 'At the peak, vertical velocity is 0 while horizontal velocity is v cos(45°) = v/√2, so KE = 1/2 mv² * (1/2).',
      },
      {
        id: 'p2',
        prompt: 'Which physical quantity remains conserved in an inelastic collision with no external net force?',
        options: ['Kinetic energy', 'Linear momentum', 'Mechanical power', 'Potential energy'],
        correctIndex: 1,
        explanation: 'Total linear momentum is conserved in all isolated collisions, even when kinetic energy is lost as heat/sound.',
      },
      {
        id: 'p3',
        prompt: 'A satellite orbits Earth in a circular path. The work done by gravity over one quarter orbit is:',
        options: ['Positive', 'Negative', 'Zero', 'Equal to GMm/r'],
        correctIndex: 2,
        explanation: 'Centripetal gravitational force is always perpendicular to instantaneous tangential displacement, so work = 0.',
      },
      {
        id: 'p4',
        prompt: 'Doubling the angular velocity ω of a solid disc increases its rotational kinetic energy by a factor of:',
        options: ['2', '4', '8', '1/2'],
        correctIndex: 1,
        explanation: 'K_rot = 1/2 Iω², which scales quadratically with ω (2² = 4).',
      },
      {
        id: 'p5',
        prompt: 'The SI unit of impulse is equivalent to the unit of:',
        options: ['Force', 'Momentum', 'Torque', 'Work'],
        correctIndex: 1,
        explanation: 'Impulse J = FΔt = Δp, sharing units (N·s or kg·m/s) with momentum.',
      },
    ],
  },
  {
    _id: 'quiz_ielts_academic',
    title: 'IELTS Academic Grammar, Cohesion & Vocabulary Check',
    subject: 'IELTS',
    level: 'Band 7.0 - 8.5',
    durationMinutes: 6,
    description: 'Sharpen academic sentence precision, cohesive linkers, and high-band collocations.',
    questions: [
      {
        id: 'e1',
        prompt: 'Choose the sentence with accurate subject-verb agreement:',
        options: [
          'The number of applicants have risen sharply.',
          'The number of applicants has risen sharply.',
          'Neither the tutor nor the students was late.',
          'Each of the modules contain five lessons.',
        ],
        correctIndex: 1,
        explanation: '"The number of + plural noun" takes a singular verb ("has"), whereas "Neither A nor B" agrees with the closer plural noun ("students were").',
      },
      {
        id: 'e2',
        prompt: 'Which cohesive device best introduces a contrasting academic viewpoint?',
        options: ['Furthermore', 'Conversely', 'Consequently', 'Similarly'],
        correctIndex: 1,
        explanation: '"Conversely" explicitly signals an opposite or contrasting perspective.',
      },
      {
        id: 'e3',
        prompt: 'Which word is closest in meaning to "ubiquitous" in an academic essay?',
        options: ['Scarce', 'Omnipresent', 'Temporary', 'Controversial'],
        correctIndex: 1,
        explanation: '"Ubiquitous" means found everywhere / omnipresent.',
      },
      {
        id: 'e4',
        prompt: 'Identify the best Task 1 trend verb for a rapid drop followed by stability:',
        options: ['Plummeted and then plateaued', 'Surged and fluctuated', 'Escalated steadily', 'Remained stagnant throughout'],
        correctIndex: 0,
        explanation: '"Plummeted" describes a sharp decline and "plateaued" describes leveling off.',
      },
      {
        id: 'e5',
        prompt: 'Select the correctly punctuated complex sentence:',
        options: [
          'Although tuition fees rose, enrollment continued to grow.',
          'Although tuition fees rose; enrollment continued to grow.',
          'Although tuition fees rose. Enrollment continued to grow.',
          'Tuition fees rose, however enrollment continued to grow.',
        ],
        correctIndex: 0,
        explanation: 'A dependent clause beginning with "Although" is joined to the main clause with a comma.',
      },
    ],
  },
  {
    _id: 'quiz_ict_python',
    title: 'ICT & Python Programming Fundamentals',
    subject: 'Programming',
    level: 'HSC ICT / University',
    durationMinutes: 7,
    description: 'Verify core skills in binary logic, time complexity, SQL, and Python data structures.',
    questions: [
      {
        id: 'c1',
        prompt: 'What is the decimal equivalent of the binary number 10110₂?',
        options: ['18', '20', '22', '26'],
        correctIndex: 2,
        explanation: '1×16 + 0×8 + 1×4 + 1×2 + 0×1 = 22.',
      },
      {
        id: 'c2',
        prompt: 'What is the average-case lookup time complexity of a Python dictionary (hash table)?',
        options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
        correctIndex: 0,
        explanation: 'Hash table key lookups run in O(1) average time.',
      },
      {
        id: 'c3',
        prompt: 'In Boolean algebra, what does De Morgan’s Law state for NOT(A AND B)?',
        options: ['(NOT A) AND (NOT B)', '(NOT A) OR (NOT B)', 'A OR (NOT B)', 'NOT(A OR B)'],
        correctIndex: 1,
        explanation: 'Complement of a conjunction equals the disjunction of the complements: !(A·B) = !A + !B.',
      },
      {
        id: 'c4',
        prompt: 'Which SQL clause filters grouped aggregate rows (such as COUNT(*) > 2)?',
        options: ['WHERE', 'ORDER BY', 'HAVING', 'DISTINCT'],
        correctIndex: 2,
        explanation: 'HAVING filters groups created by GROUP BY, whereas WHERE filters individual rows prior to grouping.',
      },
      {
        id: 'c5',
        prompt: 'What does `len(set([1, 2, 2, 3, 3, 3]))` evaluate to in Python?',
        options: ['6', '3', '2', 'Error'],
        correctIndex: 1,
        explanation: 'A Python set stores unique elements only: {1, 2, 3}, which has length 3.',
      },
    ],
  },
];

function normalizeAnswerText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.+-]/gu, ' ')
    .replace(/\.+(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-word/phrase match so that "5" does not match "15" and "ion" does not match "ionic". */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

const MAX_REWARD_ATTEMPTS_PER_HOUR = 3;
const quizSubmitLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 15,
  keyPrefix: 'quizsubmit',
  message: 'Too many quiz submissions. Please slow down.',
});

/** Reward-bearing quizzes allow only a few graded attempts per hour so answers cannot be probed. */
async function tooManyRecentAttempts(db: DatabaseHandle, userId: string, quizId: string): Promise<boolean> {
  const since = Date.now() - 60 * 60 * 1000;
  const recent = await db.quiz_attempts.count(
    (a) => a.userId === userId && a.quizId === quizId && new Date(a.createdAt).getTime() >= since,
  );
  return recent >= MAX_REWARD_ATTEMPTS_PER_HOUR;
}

/** Strips every field that would reveal the right answer. */
function maskBreakdownItem<T extends { id: string; type?: string; prompt: string }>(item: T) {
  const {
    correctIndex: _ci,
    isCorrect: _ic,
    explanation: _ex,
    sampleAnswer: _sa,
    keywords: _kw,
    ...rest
  } = item as T & Record<string, unknown>;
  return rest;
}

function evaluateCqAnswer(
  submittedRaw: string,
  sampleAnswer: string,
  keywords?: string[],
): boolean {
  const normSub = normalizeAnswerText(submittedRaw);
  const normSample = normalizeAnswerText(sampleAnswer);
  if (!normSub) return false;
  if (normSub === normSample) return true;
  if (normSample.length >= 2 && containsPhrase(normSub, normSample)) return true;

  const cleanKeywords = (keywords || [])
    .map((k) => normalizeAnswerText(k))
    .filter((k) => k.length > 0);

  if (cleanKeywords.length > 0) {
    const hits = cleanKeywords.filter((kw) => containsPhrase(normSub, kw)).length;
    const requiredHits = Math.max(1, Math.ceil(cleanKeywords.length * 0.7));
    return hits >= requiredHits;
  }

  // Fallback token overlap on significant terms & exact number matching
  const stopWords = new Set(['the', 'is', 'are', 'a', 'an', 'of', 'to', 'and', 'in', 'for', 'with', 'that', 'this']);
  const sampleNumbers: string[] = normSample.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (sampleNumbers.length > 0) {
    const allNumsMatch = sampleNumbers.every((num) => containsPhrase(normSub, num));
    if (!allNumsMatch) return false;
  }

  const tokens = normSample.split(' ').filter((t) => t.length > 2 && !stopWords.has(t));
  if (tokens.length === 0) return containsPhrase(normSub, normSample);
  const matched = tokens.filter((t) => normSub.includes(t)).length;
  return matched >= Math.max(1, Math.ceil(tokens.length * 0.6));
}

function sanitizeCustomQuizForSolver(q: CustomQuizDoc, viewerId?: string) {
  const mcqCount = q.questions.filter((item) => item.type === 'mcq').length;
  const cqCount = q.questions.filter((item) => item.type === 'cq').length;
  return {
    _id: q._id,
    title: q.title,
    subject: q.subject,
    level: q.level,
    durationMinutes: q.durationMinutes,
    description: q.description,
    authorId: q.authorId,
    authorName: q.authorName,
    authorImage: q.authorImage || '',
    visibility: q.visibility,
    audience: q.audience,
    approvalStatus: q.approvalStatus,
    rewardPerWinner: q.rewardPerWinner,
    maxWinners: q.maxWinners,
    winnersCount: q.winnersCount,
    rewardPoolTotal: q.rewardPoolTotal,
    rewardPoolRemaining: q.rewardPoolRemaining,
    isBuiltin: false,
    mcqCount,
    cqCount,
    alreadyWon: Boolean(viewerId && q.winnerUserIds.includes(viewerId)),
    isAuthor: Boolean(viewerId && q.authorId === viewerId),
    createdAt: q.createdAt,
    questions: q.questions.map((item) => ({
      id: item.id,
      type: item.type,
      prompt: item.prompt,
      ...(item.type === 'mcq' ? { options: item.options || [] } : {}),
    })),
  };
}

const router = Router();

// List Built-in + Public Approved Custom Quizzes with Search, Subject, Audience, and Kind filters
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    const audience = typeof req.query.audience === 'string' ? req.query.audience.trim() : '';
    const kind = typeof req.query.kind === 'string' ? req.query.kind.trim() : '';

    const builtinMapped = QUIZZES.map((q) => ({
      _id: q._id,
      title: q.title,
      subject: q.subject,
      level: q.level,
      durationMinutes: q.durationMinutes,
      description: q.description,
      authorId: 'platform',
      authorName: 'MentorLagbe Academic Team',
      authorImage: '',
      visibility: 'public' as const,
      audience: 'all' as const,
      approvalStatus: 'approved' as const,
      rewardPerWinner: 10,
      maxWinners: 0,
      winnersCount: 0,
      rewardPoolTotal: 0,
      rewardPoolRemaining: 0,
      isBuiltin: true,
      mcqCount: q.questions.length,
      cqCount: 0,
      alreadyWon: false,
      isAuthor: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      questions: q.questions.map((item) => ({
        id: item.id,
        type: 'mcq' as const,
        prompt: item.prompt,
        options: item.options,
      })),
    }));

    const customApproved = await db.custom_quizzes.find(
      (q) => q.visibility === 'public' && q.approvalStatus === 'approved',
    );
    customApproved.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const customMapped = customApproved.map((q) => sanitizeCustomQuizForSolver(q, req.user?._id));

    let combined = [...customMapped, ...builtinMapped];

    if (kind === 'custom') {
      combined = combined.filter((q) => !q.isBuiltin);
    } else if (kind === 'builtin') {
      combined = combined.filter((q) => q.isBuiltin);
    }

    if (search) {
      combined = combined.filter(
        (q) =>
          q.title.toLowerCase().includes(search) ||
          q.subject.toLowerCase().includes(search) ||
          q.level.toLowerCase().includes(search) ||
          q.description.toLowerCase().includes(search) ||
          q.authorName.toLowerCase().includes(search),
      );
    }

    if (subject && subject !== 'All') {
      combined = combined.filter((q) => q.subject.toLowerCase() === subject.toLowerCase());
    }

    if (audience === 'students' || audience === 'tutors' || audience === 'all') {
      combined = combined.filter((q) => q.audience === audience);
    }

    res.json({ items: combined });
  } catch (err) {
    next(err);
  }
});

// Lookup a Private (Hidden) Quiz by Share Code
const shareCodeLookupLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  keyPrefix: 'sharecode',
  message: 'Too many share-code lookups. Please wait a minute.',
});

router.get('/shared/:code', optionalAuth, shareCodeLookupLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const rawCode = String(req.params.code || '').trim().toUpperCase();
    if (!rawCode) {
      res.status(400).json({ error: 'Share code is required.' });
      return;
    }

    const db = await getDb();
    const quiz = await db.custom_quizzes.findOne((q) => q.shareCode.toUpperCase() === rawCode);
    if (!quiz) {
      res.status(404).json({ error: 'Private quiz not found for this share link or code.' });
      return;
    }

    const isAuthorOrAdmin =
      req.user && (req.user._id === quiz.authorId || req.user.role === 'admin');
    if (quiz.approvalStatus !== 'approved' && !isAuthorOrAdmin) {
      res.status(403).json({
        error: 'This quiz is awaiting Admin approval before participants can play it.',
      });
      return;
    }

    res.json({ quiz: sanitizeCustomQuizForSolver(quiz, req.user?._id) });
  } catch (err) {
    next(err);
  }
});

// Tutor views own published / pending custom quizzes & current coin wallet
router.get('/mine', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user!.role !== 'tutor' && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only Tutors and Admins can manage published quizzes.' });
      return;
    }
    const db = await getDb();
    const [items, freshUser] = await Promise.all([
      db.custom_quizzes.find(
        (q) =>
          q.authorId === req.user!._id ||
          q.authorEmail.toLowerCase() === req.user!.email.toLowerCase(),
      ),
      db.users.findOne((u) => u._id === req.user!._id),
    ]);
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({
      items,
      walletCoins: freshUser?.coins ?? req.user!.coins ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

const customQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().trim().optional(),
    type: z.literal('mcq'),
    prompt: z.string().trim().min(5, 'Question prompt must be at least 5 characters').max(500),
    options: z
      .array(z.string().trim().min(1, 'All 4 MCQ options must be filled').max(200))
      .length(4, 'Each MCQ must have exactly 4 options'),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().min(3, 'Solution explanation is required').max(600),
  }),
  z.object({
    id: z.string().trim().optional(),
    type: z.literal('cq'),
    prompt: z.string().trim().min(5, 'CQ prompt must be at least 5 characters').max(800),
    sampleAnswer: z
      .string()
      .trim()
      .min(2, 'Expected/model answer is required for CQ grading')
      .max(1000),
    keywords: z.array(z.string().trim().max(80)).max(12).optional().default([]),
    explanation: z.string().trim().min(3, 'Solution explanation is required').max(600),
  }),
]);

const createCustomQuizSchema = z
  .object({
    title: z.string().trim().min(4, 'Title must be at least 4 characters').max(140),
    subject: z.string().trim().min(2, 'Subject is required').max(60),
    level: z.string().trim().min(2, 'Class/Level is required').max(60),
    durationMinutes: z.number().int().min(2).max(180),
    description: z.string().trim().min(10, 'Description must be at least 10 characters').max(500),
    visibility: z.enum(['public', 'private']),
    audience: z.enum(['all', 'students', 'tutors']),
    rewardPerWinner: z.number().int().min(0).max(1000),
    maxWinners: z.number().int().min(0).max(2000),
    questions: z
      .array(customQuestionSchema)
      .min(1, 'Add at least 1 MCQ or CQ question')
      .max(30, 'Maximum 30 questions per quiz'),
  })
  .refine(
    (data) => (data.rewardPerWinner === 0 && data.maxWinners === 0) || (data.rewardPerWinner > 0 && data.maxWinners >= 1),
    {
      message: 'Set both reward coins per winner and winner slots (or leave both at 0 for a practice quiz).',
      path: ['maxWinners'],
    },
  );

// Tutor creates / publishes a custom quiz (goes to Admin for review & approval)
router.post('/custom', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user!.role !== 'tutor' && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only Tutors and Admins can publish quizzes.' });
      return;
    }

    const parsed = createCustomQuizSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quiz payload.' });
      return;
    }

    const db = await getDb();
    const author = await db.users.findOne((u) => u._id === req.user!._id);
    if (!author) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const totalRewardPool = parsed.data.rewardPerWinner * parsed.data.maxWinners;
    const currentCoins = author.coins ?? 0;

    if (totalRewardPool > currentCoins) {
      res.status(400).json({
        error: `Insufficient coin balance. This reward pool requires ${totalRewardPool} coins, but you currently have ${currentCoins} coins.`,
        code: 'INSUFFICIENT_COINS',
      });
      return;
    }

    const normalizedQuestions: CustomQuizQuestionDoc[] = parsed.data.questions.map((q, idx) =>
      q.type === 'mcq'
        ? {
            id: q.id || `q_${idx + 1}_${generateId().slice(0, 6)}`,
            type: 'mcq',
            prompt: q.prompt,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
          }
        : {
            id: q.id || `q_${idx + 1}_${generateId().slice(0, 6)}`,
            type: 'cq',
            prompt: q.prompt,
            sampleAnswer: q.sampleAnswer,
            keywords: (q.keywords || []).filter((k) => k.trim().length > 0),
            explanation: q.explanation,
          },
    );

    const shareCode = `MLQ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const nowIso = new Date().toISOString();

    let walletAfter = currentCoins;
    if (totalRewardPool > 0) {
      // Atomic spend: parallel requests can no longer overspend the same balance.
      const spent = await adjustCoins(db, author._id, -totalRewardPool);
      if (!spent) {
        res.status(400).json({
          error: `Insufficient coin balance. This reward pool requires ${totalRewardPool} coins.`,
          code: 'INSUFFICIENT_COINS',
        });
        return;
      }
      walletAfter = spent.coins ?? 0;
    }

    let created: CustomQuizDoc;
    try {
    created = await db.custom_quizzes.insertOne({
      _id: `cqz_${generateId()}`,
      title: parsed.data.title,
      subject: parsed.data.subject,
      level: parsed.data.level,
      durationMinutes: parsed.data.durationMinutes,
      description: parsed.data.description,
      authorId: author._id,
      authorName: author.name,
      authorEmail: author.email,
      authorImage: author.image,
      visibility: parsed.data.visibility,
      shareCode,
      audience: parsed.data.audience,
      approvalStatus: 'pending',
      rewardPerWinner: parsed.data.rewardPerWinner,
      maxWinners: parsed.data.maxWinners,
      winnersCount: 0,
      winnerUserIds: [],
      rewardPoolTotal: totalRewardPool,
      rewardPoolRemaining: totalRewardPool,
      questions: normalizedQuestions,
      createdAt: nowIso,
    });
    } catch (insertErr) {
      if (totalRewardPool > 0) await adjustCoins(db, author._id, totalRewardPool);
      throw insertErr;
    }

    await createNotification(db, {
      userEmail: author.email,
      title: 'Quiz Submitted for Admin Review',
      message: `"${created.title}" has been submitted${totalRewardPool > 0 ? ` with a ${totalRewardPool}-coin reward pool` : ''}. An Admin will review and approve it shortly.`,
      type: 'moderation',
      link: '/dashboard/tutor/quizzes',
    });

    res.status(201).json({
      quiz: created,
      walletCoins: walletAfter,
    });
  } catch (err) {
    next(err);
  }
});

// Tutor toggles public / private visibility on own quiz
router.patch('/custom/:id/visibility', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const schema = z.object({ visibility: z.enum(['public', 'private']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Visibility must be public or private.' });
      return;
    }

    const db = await getDb();
    const existing = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    const isOwner =
      existing.authorId === req.user!._id ||
      existing.authorEmail.toLowerCase() === req.user!.email.toLowerCase();
    if (!isOwner && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only the quiz creator or Admin can change visibility.' });
      return;
    }

    const updated = await db.custom_quizzes.updateOne(
      (q) => q._id === existing._id,
      (q) => ({
        ...q,
        visibility: parsed.data.visibility,
        updatedAt: new Date().toISOString(),
      }),
    );

    res.json({ quiz: updated });
  } catch (err) {
    next(err);
  }
});

// Owner tutor or Admin deletes a custom quiz (refunds any unclaimed coin prize pool to author)
router.delete('/custom/:id', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    const isOwner =
      existing.authorId === req.user!._id ||
      existing.authorEmail.toLowerCase() === req.user!.email.toLowerCase();
    if (!isOwner && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You cannot delete another tutor’s quiz.' });
      return;
    }

    const refundAmount = existing.rewardPoolRemaining > 0 ? existing.rewardPoolRemaining : 0;
    const deleted = await db.custom_quizzes.deleteOne((q) => q._id === existing._id);
    if (!deleted) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    let updatedAuthorCoins: number | undefined;
    if (refundAmount > 0) {
      const refundedUser = await adjustCoins(db, existing.authorId, refundAmount);
      updatedAuthorCoins = refundedUser?.coins;
    }

    res.json({
      message: refundAmount > 0 ? `Quiz deleted and ${refundAmount} unclaimed coins refunded.` : 'Quiz deleted.',
      refundedCoins: refundAmount,
      walletCoins: updatedAuthorCoins,
    });
  } catch (err) {
    next(err);
  }
});

// Admin: list all custom quizzes for review
router.get('/admin/all', verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const db = await getDb();
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    let items = await db.custom_quizzes.findAll();
    if (status && status !== 'all') {
      items = items.filter((q) => q.approvalStatus === status);
    }
    const statusOrder: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
    items.sort((a, b) => {
      const orderDiff = (statusOrder[a.approvalStatus] ?? 9) - (statusOrder[b.approvalStatus] ?? 9);
      if (orderDiff !== 0) return orderDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Admin: approve or reject a tutor-submitted quiz (refunds escrowed pool on rejection)
router.patch('/custom/:id/moderation', verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const schema = z.object({
      approvalStatus: z.enum(['pending', 'approved', 'rejected']),
      rejectionReason: z.string().trim().max(400).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid moderation status payload.' });
      return;
    }

    const db = await getDb();
    const existing = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Custom quiz not found.' });
      return;
    }

    if (
      parsed.data.approvalStatus === 'approved' &&
      existing.approvalStatus === 'rejected' &&
      existing.rewardPoolTotal > 0 &&
      existing.rewardPoolRemaining === 0 &&
      existing.winnersCount === 0
    ) {
      res.status(400).json({
        error: 'This rejected quiz already had its coin pool refunded. Ask the tutor to publish a new quiz.',
      });
      return;
    }

    let refundCoins = 0;
    if (parsed.data.approvalStatus === 'rejected' && existing.rewardPoolRemaining > 0) {
      // Zero the pool first (compare-and-swap) so a double click can never refund twice.
      const swapped = await db.custom_quizzes.replaceIfUnchanged(
        existing._id,
        { rewardPoolRemaining: existing.rewardPoolRemaining },
        { ...existing, rewardPoolRemaining: 0 },
      );
      if (swapped) {
        refundCoins = existing.rewardPoolRemaining;
        await adjustCoins(db, existing.authorId, refundCoins);
      }
    }

    const updated = await db.custom_quizzes.updateOne(
      (q) => q._id === existing._id,
      (q) => ({
        ...q,
        approvalStatus: parsed.data.approvalStatus,
        ...(typeof parsed.data.rejectionReason === 'string'
          ? { rejectionReason: parsed.data.rejectionReason }
          : {}),
        ...(refundCoins > 0 ? { rewardPoolRemaining: 0 } : {}),
        updatedAt: new Date().toISOString(),
      }),
    );

    if (parsed.data.approvalStatus !== existing.approvalStatus) {
      await createNotification(db, {
        userEmail: existing.authorEmail,
        title: `Quiz ${parsed.data.approvalStatus}`,
        message:
          parsed.data.approvalStatus === 'approved'
            ? `Your quiz "${existing.title}" is approved and ready (${existing.visibility === 'private' ? 'share via private link' : 'live in Quiz Hub'}).`
            : `Your quiz "${existing.title}" was rejected.${refundCoins > 0 ? ` ${refundCoins} coins were refunded to your wallet.` : ''}`,
        type: 'moderation',
        link: '/dashboard/tutor/quizzes',
      });
    }

    res.json({ quiz: updated, refundedCoins: refundCoins });
  } catch (err) {
    next(err);
  }
});

// Solver submits answers (MCQ + CQ) for a tutor-published custom quiz and claims coins on 100% score
router.post('/custom/:id/submit', verifyToken, quizSubmitLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const quiz = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!quiz) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    const isAuthorOrAdmin =
      req.user!._id === quiz.authorId || req.user!.role === 'admin';

    if (quiz.approvalStatus !== 'approved' && !isAuthorOrAdmin) {
      res.status(403).json({ error: 'This quiz is pending Admin approval and cannot be submitted yet.' });
      return;
    }

    const submitSchema = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(10)).optional().default({}),
      writtenAnswers: z.record(z.string(), z.string().max(2000)).optional().default({}),
      shareCode: z.string().trim().max(40).optional(),
    });
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid quiz submission payload.' });
      return;
    }

    if (quiz.visibility === 'private' && !isAuthorOrAdmin) {
      const provided = (parsed.data.shareCode || '').trim().toUpperCase();
      if (!provided || provided !== quiz.shareCode.toUpperCase()) {
        res.status(403).json({ error: 'Valid private share link code is required for this quiz.' });
        return;
      }
    }

    // Audience access check
    if (quiz.audience === 'students' && req.user!.role !== 'student' && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'This quiz is exclusively for Students.' });
      return;
    }
    if (quiz.audience === 'tutors' && req.user!.role !== 'tutor' && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'This quiz is exclusively for Tutors.' });
      return;
    }

    const prizeAtStake =
      !isAuthorOrAdmin &&
      quiz.approvalStatus === 'approved' &&
      quiz.rewardPerWinner > 0 &&
      quiz.rewardPoolRemaining >= quiz.rewardPerWinner &&
      quiz.winnersCount < quiz.maxWinners &&
      !quiz.winnerUserIds.includes(req.user!._id);

    if (prizeAtStake && (await tooManyRecentAttempts(db, req.user!._id, quiz._id))) {
      res.status(429).json({
        error: 'Attempt limit reached for this reward quiz. Please wait an hour before trying again.',
        code: 'ATTEMPT_LIMIT',
      });
      return;
    }

    let score = 0;
    const breakdown = quiz.questions.map((q) => {
      if (q.type === 'mcq') {
        const selectedIndex =
          typeof parsed.data.answers[q.id] === 'number' ? parsed.data.answers[q.id] : -1;
        const isCorrect = selectedIndex === q.correctIndex;
        if (isCorrect) score += 1;
        return {
          id: q.id,
          type: 'mcq' as const,
          prompt: q.prompt,
          options: q.options || [],
          selectedIndex,
          correctIndex: q.correctIndex ?? 0,
          isCorrect,
          explanation: q.explanation,
        };
      }

      const submittedText = String(parsed.data.writtenAnswers[q.id] || '').trim();
      const isCorrect = evaluateCqAnswer(submittedText, q.sampleAnswer || '', q.keywords);
      if (isCorrect) score += 1;
      return {
        id: q.id,
        type: 'cq' as const,
        prompt: q.prompt,
        submittedText,
        sampleAnswer: q.sampleAnswer || '',
        keywords: q.keywords || [],
        isCorrect,
        explanation: q.explanation,
      };
    });

    const total = quiz.questions.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
    const allCorrect = total > 0 && score === total;

    let coinsEarned = 0;
    let rewardNote = '';

    let prizeClaimed = false;
    if (allCorrect && prizeAtStake) {
      // Compare-and-swap loop: only one request can ever claim a given winner slot per user.
      for (let tries = 0; tries < 4 && !prizeClaimed; tries += 1) {
        const fresh = await db.custom_quizzes.findById(quiz._id);
        if (
          !fresh ||
          fresh.approvalStatus !== 'approved' ||
          fresh.rewardPerWinner <= 0 ||
          fresh.rewardPoolRemaining < fresh.rewardPerWinner ||
          fresh.winnersCount >= fresh.maxWinners ||
          fresh.winnerUserIds.includes(req.user!._id)
        ) {
          break;
        }
        prizeClaimed = await db.custom_quizzes.replaceIfUnchanged(
          fresh._id,
          { winnersCount: fresh.winnersCount, rewardPoolRemaining: fresh.rewardPoolRemaining },
          {
            ...fresh,
            winnersCount: fresh.winnersCount + 1,
            winnerUserIds: [...fresh.winnerUserIds, req.user!._id],
            rewardPoolRemaining: fresh.rewardPoolRemaining - fresh.rewardPerWinner,
            updatedAt: new Date().toISOString(),
          },
        );
        if (prizeClaimed) coinsEarned = fresh.rewardPerWinner;
      }
    }

    if (prizeClaimed) {
      await adjustCoins(db, req.user!._id, coinsEarned);
      await createNotification(db, {
        userEmail: req.user!.email,
        title: `Won +${coinsEarned} Coins!`,
        message: `You answered all ${total} questions correctly in "${quiz.title}" and earned ${coinsEarned} coins.`,
        type: 'system',
        link: '/quizzes',
      });
      rewardNote = `Congratulations! You answered every question correctly and earned +${coinsEarned} coins.`;
    } else if (allCorrect && quiz.winnerUserIds.includes(req.user!._id)) {
      rewardNote = 'You already claimed the coin reward for this quiz on an earlier attempt.';
    } else if (allCorrect && quiz.rewardPerWinner > 0 && quiz.rewardPoolRemaining < quiz.rewardPerWinner) {
      rewardNote = 'Great score! All coin winner slots for this quiz have already been claimed.';
    } else if (allCorrect && req.user!._id === quiz.authorId) {
      rewardNote = 'Author preview attempt complete (authors cannot claim their own quiz pool).';
    } else if (!allCorrect && quiz.rewardPerWinner > 0 && quiz.rewardPoolRemaining >= quiz.rewardPerWinner) {
      rewardNote = `Answer all ${total} questions correctly to win +${quiz.rewardPerWinner} coins.`;
    }

    await db.quiz_attempts.insertOne({
      _id: `qatt_${generateId()}`,
      userId: req.user!._id,
      userEmail: req.user!.email,
      quizId: quiz._id,
      quizTitle: quiz.title,
      subject: quiz.subject,
      score,
      total,
      percentage,
      coinsEarned,
      passed: allCorrect,
      writtenAnswers: parsed.data.writtenAnswers,
      createdAt: new Date().toISOString(),
    });

    const latestUser = await db.users.findOne((u) => u._id === req.user!._id);
    const latestQuiz = await db.custom_quizzes.findOne((q) => q._id === quiz._id);

    res.json({
      quizId: quiz._id,
      title: quiz.title,
      score,
      total,
      percentage,
      allCorrect,
      coinsEarned,
      rewardNote,
      walletCoins: latestUser?.coins ?? req.user!.coins ?? 0,
      rewardPoolRemaining: latestQuiz?.rewardPoolRemaining ?? quiz.rewardPoolRemaining,
      winnersCount: latestQuiz?.winnersCount ?? quiz.winnersCount,
      // While a coin prize is still at stake, correct answers stay hidden until the solver wins it.
      breakdown: allCorrect || !prizeAtStake ? breakdown : breakdown.map((item) => maskBreakdownItem(item)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/attempts/mine', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const items = await db.quiz_attempts.find((a) => a.userId === req.user!._id);
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: items.slice(0, 20) });
  } catch (err) {
    next(err);
  }
});

function formatProgressSummary(doc: DailyQuizProgressDoc | null, todayKey: string) {
  const completedLevel = doc?.completedLevel ?? 0;
  const lastCompletedDate = doc?.lastCompletedDate ?? null;
  const completedToday = Boolean(lastCompletedDate && lastCompletedDate === todayKey);
  const prevKey = getPreviousDhakaDateKey(todayKey);
  const activeStreak =
    doc && (doc.lastCompletedDate === todayKey || doc.lastCompletedDate === prevKey)
      ? doc.streak
      : 0;
  const allCompleted = completedLevel >= TOTAL_DAILY_LEVELS;
  const nextLevel = allCompleted ? null : completedLevel + 1;

  return {
    completedLevel,
    lastCompletedDate,
    completedToday,
    allCompleted,
    nextLevel,
    playableToday: !allCompleted && !completedToday,
    streak: activeStreak,
    totalXp: doc?.totalXp ?? 0,
    unlockedBadgeLevels: [...(doc?.unlockedBadgeLevels ?? [])].sort((a, b) => a - b),
  };
}

function parseQueryTrack(raw: unknown): DailyTrack | null {
  if (raw === 'tutor' || raw === 'student') return raw;
  return null;
}

router.get('/daily/overview', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const todayKey = getDhakaDateKey();
    const userTrack: DailyTrack = req.user ? resolveDailyTrack(req.user.role) : 'student';
    const requestedTrack = parseQueryTrack(req.query.track);
    const activeTrack: DailyTrack = requestedTrack ?? userTrack;
    const isOwnTrack = Boolean(req.user && (req.user.role === 'admin' || activeTrack === userTrack));

    let progressDoc: DailyQuizProgressDoc | null = null;
    if (req.user && isOwnTrack) {
      const db = await getDb();
      progressDoc = await db.quiz_daily_progress.findOne((p) => p.userId === req.user!._id);
    }
    const progress = formatProgressSummary(progressDoc, todayKey);
    const unlockedSet = new Set(progress.unlockedBadgeLevels);
    const trackMilestones = getAllMilestoneBadges(activeTrack);

    res.json({
      track: activeTrack,
      userTrack: req.user ? userTrack : null,
      isOwnTrack,
      totalLevels: TOTAL_DAILY_LEVELS,
      passingScore: DAILY_PASSING_SCORE,
      todayKey,
      authenticated: Boolean(req.user),
      progress,
      milestones: trackMilestones.map((b) => ({
        ...b,
        unlocked: unlockedSet.has(b.level),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/daily/level/:level', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const level = Number(req.params.level);
    if (!Number.isInteger(level) || level < 1 || level > TOTAL_DAILY_LEVELS) {
      res.status(400).json({ error: `Level must be an integer between 1 and ${TOTAL_DAILY_LEVELS}.` });
      return;
    }

    const todayKey = getDhakaDateKey();
    const userTrack: DailyTrack = req.user ? resolveDailyTrack(req.user.role) : 'student';
    const requestedTrack = parseQueryTrack(req.query.track);
    const activeTrack: DailyTrack = requestedTrack ?? userTrack;
    const isOwnTrack = Boolean(req.user && (req.user.role === 'admin' || activeTrack === userTrack));
    let isReplay = false;

    if (!req.user || !isOwnTrack) {
      if (level !== 1) {
        res.status(req.user ? 403 : 401).json({
          error: req.user
            ? `Your account belongs to the ${userTrack === 'tutor' ? 'Tutor' : 'Student'} Daily Track. Switch back to your track to continue past Level 1.`
            : 'Please sign in to unlock and track progress across all 1,000 levels.',
          code: req.user ? 'TRACK_PREVIEW_ONLY' : 'AUTH_REQUIRED',
        });
        return;
      }
    } else {
      const db = await getDb();
      const progressDoc = await db.quiz_daily_progress.findOne((p) => p.userId === req.user!._id);
      const completedLevel = progressDoc?.completedLevel ?? 0;
      const completedToday = Boolean(progressDoc && progressDoc.lastCompletedDate === todayKey);
      isReplay = level <= completedLevel;

      if (level > completedLevel + 1) {
        res.status(403).json({
          error: `Level ${level} is locked. Pass Level ${completedLevel + 1} next to advance.`,
          code: 'LEVEL_LOCKED',
        });
        return;
      }

      if (!isReplay && completedToday) {
        res.status(403).json({
          error:
            'Daily limit reached: you already completed 1 new level today. Replay completed levels or return tomorrow!',
          code: 'DAILY_LIMIT_REACHED',
        });
        return;
      }
    }

    const quizDef = generateDailyLevelQuiz(level, activeTrack);
    res.json({
      level: quizDef.level,
      track: quizDef.track,
      trackLabel: quizDef.trackLabel,
      isOwnTrack,
      tierName: quizDef.tierName,
      title: quizDef.title,
      subjectMix: quizDef.subjectMix,
      passingScore: quizDef.passingScore,
      xpReward: quizDef.xpReward,
      badge: quizDef.badge,
      isReplay,
      questions: quizDef.questions.map((q) => ({
        id: q.id,
        subject: q.subject,
        prompt: q.prompt,
        options: q.options,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/daily/level/:level/submit', verifyToken, quizSubmitLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const level = Number(req.params.level);
    if (!Number.isInteger(level) || level < 1 || level > TOTAL_DAILY_LEVELS) {
      res.status(400).json({ error: `Level must be an integer between 1 and ${TOTAL_DAILY_LEVELS}.` });
      return;
    }

    const schema = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(3)),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid quiz submission payload.' });
      return;
    }

    const track = resolveDailyTrack(req.user!.role);
    const db = await getDb();
    const todayKey = getDhakaDateKey();
    let progressDoc = await db.quiz_daily_progress.findOne((p) => p.userId === req.user!._id);
    const completedLevel = progressDoc?.completedLevel ?? 0;
    const completedToday = Boolean(progressDoc && progressDoc.lastCompletedDate === todayKey);
    const isReplay = level <= completedLevel;

    if (level > completedLevel + 1) {
      res.status(403).json({
        error: `Level ${level} is locked. Pass Level ${completedLevel + 1} next to advance.`,
        code: 'LEVEL_LOCKED',
      });
      return;
    }

    if (!isReplay && completedToday) {
      res.status(403).json({
        error:
          'Daily limit reached: you can only advance 1 new level per day. Replay completed levels or return tomorrow!',
        code: 'DAILY_LIMIT_REACHED',
      });
      return;
    }

    const dailyQuizId = `daily_${track}_level_${level}`;
    if (!isReplay && (await tooManyRecentAttempts(db, req.user!._id, dailyQuizId))) {
      res.status(429).json({
        error: 'Too many attempts on this level. Please wait an hour before trying again.',
        code: 'ATTEMPT_LIMIT',
      });
      return;
    }

    const quizDef = generateDailyLevelQuiz(level, track);
    let score = 0;
    const breakdown = quizDef.questions.map((q) => {
      const selectedIndex =
        typeof parsed.data.answers[q.id] === 'number' ? parsed.data.answers[q.id] : -1;
      const isCorrect = selectedIndex === q.correctIndex;
      if (isCorrect) score += 1;
      return {
        id: q.id,
        subject: q.subject,
        prompt: q.prompt,
        options: q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation,
      };
    });

    const total = quizDef.questions.length;
    const percentage = Math.round((score / total) * 100);
    const passed = score >= quizDef.passingScore;
    let newlyUnlockedBadge: DailyBadgeDef | null = null;
    let xpAwarded = 0;
    let coinsAwarded = 0;

    if (!isReplay && passed) {
      const prevKey = getPreviousDhakaDateKey(todayKey);
      const nextStreak =
        progressDoc && progressDoc.lastCompletedDate === prevKey ? progressDoc.streak + 1 : 1;
      const nextXp = (progressDoc?.totalXp ?? 0) + quizDef.xpReward;
      const nextBadges = new Set(progressDoc?.unlockedBadgeLevels ?? []);
      if (quizDef.badge && !nextBadges.has(quizDef.badge.level)) {
        nextBadges.add(quizDef.badge.level);
        newlyUnlockedBadge = quizDef.badge;
      }
      const sortedBadges = Array.from(nextBadges).sort((a, b) => a - b);
      const nowIso = new Date().toISOString();

      // Compare-and-swap so two parallel submits can't both collect the same level's reward.
      let levelClaimed = false;
      if (progressDoc) {
        const nextDoc = {
          ...progressDoc,
          track,
          completedLevel: level,
          lastCompletedDate: todayKey,
          streak: nextStreak,
          totalXp: nextXp,
          unlockedBadgeLevels: sortedBadges,
          updatedAt: nowIso,
        };
        levelClaimed = await db.quiz_daily_progress.replaceIfUnchanged(
          progressDoc._id,
          {
            completedLevel: progressDoc.completedLevel,
            lastCompletedDate: progressDoc.lastCompletedDate,
          },
          nextDoc,
        );
        if (levelClaimed) progressDoc = nextDoc;
      } else {
        try {
          progressDoc = await db.quiz_daily_progress.insertOne({
            _id: `dqp_${generateId()}`,
            userId: req.user!._id,
            userEmail: req.user!.email,
            track,
            completedLevel: level,
            lastCompletedDate: todayKey,
            streak: nextStreak,
            totalXp: nextXp,
            unlockedBadgeLevels: sortedBadges,
            updatedAt: nowIso,
          });
          levelClaimed = true;
        } catch (err) {
          if (!isDuplicateKeyError(err)) throw err;
        }
      }

      if (!levelClaimed) newlyUnlockedBadge = null;
      if (levelClaimed) {
        xpAwarded = quizDef.xpReward;
        coinsAwarded = 15;
        await adjustCoins(db, req.user!._id, coinsAwarded);
      }

      if (levelClaimed) await db.quiz_attempts.insertOne({
        _id: `qatt_${generateId()}`,
        userId: req.user!._id,
        userEmail: req.user!.email,
        quizId: `daily_${track}_level_${level}`,
        quizTitle: quizDef.title,
        subject: track === 'tutor' ? 'Tutor Daily 1,000-Level' : 'Student Daily 1,000-Level',
        score,
        total,
        percentage,
        coinsEarned: coinsAwarded,
        passed: true,
        createdAt: nowIso,
      });

      if (newlyUnlockedBadge) {
        await createNotification(db, {
          userEmail: req.user!.email,
          title: `${track === 'tutor' ? 'Tutor' : 'Student'} Badge Unlocked: ${newlyUnlockedBadge.name}`,
          message: `You passed Level ${level} (${score}/${total}), earned +${coinsAwarded} coins, and unlocked the ${newlyUnlockedBadge.tier} milestone badge.`,
          type: 'system',
          link: '/quizzes?mode=daily',
        });
      }
    }

    if (!isReplay && !passed) {
      await db.quiz_attempts.insertOne({
        _id: `qatt_${generateId()}`,
        userId: req.user!._id,
        userEmail: req.user!.email,
        quizId: dailyQuizId,
        quizTitle: quizDef.title,
        subject: track === 'tutor' ? 'Tutor Daily 1,000-Level' : 'Student Daily 1,000-Level',
        score,
        total,
        percentage,
        coinsEarned: 0,
        passed: false,
        createdAt: new Date().toISOString(),
      });
    }

    const latestUser = await db.users.findById(req.user!._id);

    res.json({
      level: quizDef.level,
      track,
      trackLabel: quizDef.trackLabel,
      title: quizDef.title,
      passed,
      score,
      total,
      percentage,
      passingScore: quizDef.passingScore,
      xpAwarded,
      coinsAwarded,
      walletCoins: latestUser?.coins ?? req.user!.coins ?? 0,
      isReplay,
      newlyUnlockedBadge,
      progress: formatProgressSummary(progressDoc, todayKey),
      // Answers are revealed only once the level is passed (or when replaying a finished level).
      breakdown: isReplay || passed ? breakdown : breakdown.map((item) => maskBreakdownItem(item)),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/submit', optionalAuth, quizSubmitLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const quiz = QUIZZES.find((q) => q._id === req.params.id);
    if (!quiz) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    const schema = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(10)),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid quiz submission payload.' });
      return;
    }

    if (req.user) {
      const dbForCap = await getDb();
      const alreadyRewarded = await dbForCap.quiz_attempts.findOne(
        (a) => a.userId === req.user!._id && a.quizId === quiz._id && (a.coinsEarned ?? 0) > 0,
      );
      if (!alreadyRewarded && (await tooManyRecentAttempts(dbForCap, req.user._id, quiz._id))) {
        res.status(429).json({
          error: 'Too many attempts on this quiz. Please wait an hour before trying again.',
          code: 'ATTEMPT_LIMIT',
        });
        return;
      }
    }

    let score = 0;
    const breakdown = quiz.questions.map((q) => {
      const selectedIndex =
        typeof parsed.data.answers[q.id] === 'number' ? parsed.data.answers[q.id] : -1;
      const isCorrect = selectedIndex === q.correctIndex;
      if (isCorrect) score += 1;
      return {
        id: q.id,
        type: 'mcq' as const,
        prompt: q.prompt,
        options: q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation,
      };
    });

    const total = quiz.questions.length;
    const percentage = Math.round((score / total) * 100);
    let coinsEarned = 0;
    let walletCoins = req.user?.coins ?? 0;

    if (req.user) {
      const db = await getDb();
      if (percentage >= 60) {
        const priorRewarded = await db.quiz_attempts.findOne(
          (a) => a.userId === req.user!._id && a.quizId === quiz._id && (a.coinsEarned ?? 0) > 0,
        );
        if (!priorRewarded) {
          // claimOnce is atomic, so parallel submissions cannot both collect the 10 coins.
          const firstClaim = await db.users.claimOnce(req.user._id, 'claimedQuizIds', quiz._id);
          if (firstClaim) {
            coinsEarned = 10;
            const updatedUser = await adjustCoins(db, req.user._id, coinsEarned);
            walletCoins = updatedUser?.coins ?? walletCoins + coinsEarned;
          }
        }
      }

      await db.quiz_attempts.insertOne({
        _id: `qatt_${generateId()}`,
        userId: req.user._id,
        userEmail: req.user.email,
        quizId: quiz._id,
        quizTitle: quiz.title,
        subject: quiz.subject,
        score,
        total,
        percentage,
        coinsEarned,
        passed: percentage >= 60,
        createdAt: new Date().toISOString(),
      });
    }

    res.json({
      quizId: quiz._id,
      title: quiz.title,
      score,
      total,
      percentage,
      coinsEarned,
      walletCoins,
      // Correct answers are only shown once the quiz is passed.
      breakdown: percentage >= 60 ? breakdown : breakdown.map((item) => maskBreakdownItem(item)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
