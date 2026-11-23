import express, { Router } from 'express';
import Stripe from 'stripe';
import crypto from 'crypto';
import { getDb, generateId, isDuplicateKeyError } from '../db.ts';
import { sanitizeUser, verifyToken, type AuthenticatedRequest } from '../middleware/auth.ts';
import { paymentRateLimiter } from '../middleware/rateLimit.ts';
import { getPrimaryAppOrigin, isProduction } from '../config/env.ts';
import type { UserRole } from '../types.ts';

const router = Router();

interface PendingCheckoutSession {
  sessionId: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: UserRole;
  planName: string;
  amount: number;
  createdAt: number;
}

const pendingTestSessions = new Map<string, PendingCheckoutSession>();

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.startsWith('sk_test_replace')) return null;
  return new Stripe(key);
}

function getOrigin(req: express.Request): string {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const host = typeof req.headers.host === 'string' ? req.headers.host : undefined;
  return getPrimaryAppOrigin(origin, host);
}

function isSandboxPaymentAllowed(): boolean {
  if (!isProduction()) return true;
  return process.env.ALLOW_PAYMENT_SANDBOX === 'true';
}

async function fulfillProUpgrade(params: {
  userEmail: string;
  userName: string;
  userRole: UserRole;
  planName: string;
  amount: number;
  currency: string;
  stripeSessionId: string;
  transactionId: string;
}) {
  const db = await getDb();

  const existingPayment = await db.payments.findOne(
    (p) =>
      p.stripeSessionId === params.stripeSessionId || p.transactionId === params.transactionId,
  );
  if (existingPayment) {
    const user = await db.users.findOne(
      (u) => u.email.toLowerCase() === params.userEmail.toLowerCase(),
    );
    return {
      payment: existingPayment,
      user: user ? sanitizeUser(user) : null,
      alreadyProcessed: true,
    };
  }

  let payment;
  try {
    payment = await db.payments.insertOne({
      _id: `pay_${generateId()}`,
      userEmail: params.userEmail,
      userName: params.userName,
      userRole: params.userRole,
      planName: params.planName,
      amount: params.amount,
      currency: params.currency,
      transactionId: params.transactionId,
      stripeSessionId: params.stripeSessionId,
      paymentStatus: 'paid',
      paidAt: new Date().toISOString(),
    });
  } catch (err) {
    // The webhook and /verify-session can race; the unique index means the loser lands here.
    if (!isDuplicateKeyError(err)) throw err;
    const raced = await db.payments.findByField('stripeSessionId', params.stripeSessionId);
    const racedUser = await db.users.findByField('email', params.userEmail.toLowerCase());
    if (!raced) throw err;
    return {
      payment: raced,
      user: racedUser ? sanitizeUser(racedUser) : null,
      alreadyProcessed: true,
    };
  }

  const updatedUser = await db.users.updateOne(
    (u) => u.email.toLowerCase() === params.userEmail.toLowerCase(),
    (u) => ({
      ...u,
      plan: 'pro',
    }),
  );

  if (updatedUser?.role === 'tutor') {
    await db.tuitions.updateMany(
      (t) => t.tutorEmail.toLowerCase() === updatedUser.email.toLowerCase(),
      (t) => ({ ...t, tutorPlan: 'pro' }),
    );
  }

  return {
    payment,
    user: updatedUser ? sanitizeUser(updatedUser) : null,
    alreadyProcessed: false,
  };
}

// Create Stripe Checkout Session ($10 Pro Student / $15 Pro Tutor)
router.post(
  '/create-checkout-session',
  verifyToken,
  paymentRateLimiter,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = await getDb();
      const user = await db.users.findOne((u) => u._id === req.user!._id);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      if (user.role === 'admin') {
        res.status(400).json({ error: 'Pro plans apply to Student and Tutor accounts only.' });
        return;
      }
      if (user.plan === 'pro') {
        res.status(400).json({ error: 'Your account is already on a Pro plan.' });
        return;
      }

      const isTutor = user.role === 'tutor';
      const amount = isTutor ? 15 : 10;
      const planName = isTutor ? 'Pro Tutor' : 'Pro Student';
      const origin = getOrigin(req);

      const stripe = getStripeClient();
      if (stripe) {
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: user.email,
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `MentorLagbe ${planName} Plan`,
                  description: isTutor
                    ? 'Unlimited tuition listings and Pro Tutor badge.'
                    : 'Unlimited bookmarked tuitions and Pro Student badge.',
                },
                unit_amount: Math.round(amount * 100),
              },
              quantity: 1,
            },
          ],
          metadata: {
            userId: user._id,
            userEmail: user.email,
            userName: user.name,
            userRole: user.role,
            planName,
            amount: String(amount),
          },
          success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/payment/cancel`,
        });

        res.json({
          checkoutUrl: session.url,
          sessionId: session.id,
          mode: 'stripe_live',
          amount,
        });
        return;
      }

      if (!isSandboxPaymentAllowed()) {
        res.status(503).json({
          error: 'Stripe checkout is not configured on this server.',
        });
        return;
      }

      const sessionId = `cs_test_${crypto.randomBytes(16).toString('hex')}`;
      pendingTestSessions.set(sessionId, {
        sessionId,
        userId: user._id,
        userEmail: user.email,
        userName: user.name,
        userRole: user.role,
        planName,
        amount,
        createdAt: Date.now(),
      });

      res.json({
        checkoutUrl: `${origin}/payment/stripe-checkout?session_id=${encodeURIComponent(sessionId)}`,
        sessionId,
        mode: 'stripe_sandbox',
        amount,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/session-preview/:sessionId', verifyToken, (req: AuthenticatedRequest, res) => {
  const session = pendingTestSessions.get(req.params.sessionId);
  if (!session || session.userId !== req.user!._id) {
    res.status(404).json({ error: 'Checkout session not found or expired.' });
    return;
  }
  res.json({ session });
});

router.post('/verify-session', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId.trim() : '';
    if (!sessionId) {
      res.status(400).json({ error: 'Stripe session ID is required.' });
      return;
    }

    const db = await getDb();
    const existing = await db.payments.findOne((p) => p.stripeSessionId === sessionId);
    if (existing) {
      const user = await db.users.findOne(
        (u) => u.email.toLowerCase() === existing.userEmail.toLowerCase(),
      );
      res.json({
        verified: true,
        payment: existing,
        user: user ? sanitizeUser(user) : req.user,
      });
      return;
    }

    const stripe = getStripeClient();
    if (stripe && !pendingTestSessions.has(sessionId)) {
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
      } catch (stripeErr) {
        if (stripeErr instanceof Stripe.errors.StripeInvalidRequestError) {
          res.status(400).json({ error: 'Invalid checkout session.' });
          return;
        }
        throw stripeErr;
      }
      if (session.payment_status !== 'paid') {
        res.status(400).json({ error: 'Payment has not been completed yet.' });
        return;
      }

      const metaEmail = session.metadata?.userEmail || session.customer_email || req.user!.email;
      if (metaEmail.toLowerCase() !== req.user!.email.toLowerCase()) {
        res.status(403).json({ error: 'Unauthorized payment session verification.' });
        return;
      }

      const amount = Number(
        session.amount_total ? session.amount_total / 100 : session.metadata?.amount || 10,
      );
      const planName =
        session.metadata?.planName || (req.user!.role === 'tutor' ? 'Pro Tutor' : 'Pro Student');
      const transactionId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : `pi_${crypto.randomBytes(10).toString('hex')}`;

      const result = await fulfillProUpgrade({
        userEmail: req.user!.email,
        userName: req.user!.name,
        userRole: req.user!.role,
        planName,
        amount,
        currency: (session.currency || 'usd').toUpperCase(),
        stripeSessionId: session.id,
        transactionId,
      });

      res.json({ verified: true, ...result });
      return;
    }

    if (!isSandboxPaymentAllowed()) {
      res.status(503).json({ error: 'Sandbox payment verification is disabled in production.' });
      return;
    }

    const pending = pendingTestSessions.get(sessionId);
    if (!pending || pending.userId !== req.user!._id) {
      res.status(404).json({ error: 'Payment session could not be verified.' });
      return;
    }

    const transactionId = `pi_test_${crypto.randomBytes(10).toString('hex')}`;
    const result = await fulfillProUpgrade({
      userEmail: pending.userEmail,
      userName: pending.userName,
      userRole: pending.userRole,
      planName: pending.planName,
      amount: pending.amount,
      currency: 'USD',
      stripeSessionId: pending.sessionId,
      transactionId,
    });
    pendingTestSessions.delete(sessionId);

    res.json({ verified: true, ...result });
  } catch (err) {
    next(err);
  }
});

export async function stripeWebhookHandler(
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const sig = req.headers['stripe-signature'];

  if (!stripe || !webhookSecret || typeof sig !== 'string') {
    res.status(400).json({ error: 'Stripe webhook signature configuration missing.' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    res.status(400).json({ error: `Webhook verification failed: ${(err as Error).message}` });
    return;
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // Respond 500 so Stripe retries later, but never let an async error crash the process.
    console.error('[Stripe webhook] Failed to process event', event.id, err);
    res.status(500).json({ error: 'Webhook processing failed.' });
    return;
  }

  res.json({ received: true });
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === 'paid') {
      const userEmail = session.metadata?.userEmail || session.customer_email || '';
      const userName = session.metadata?.userName || 'MentorLagbe Member';
      const userRole = (session.metadata?.userRole as UserRole) || 'student';
      const planName = session.metadata?.planName || 'Pro Plan';
      const amount = Number(
        session.amount_total ? session.amount_total / 100 : session.metadata?.amount || 10,
      );
      const transactionId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : `pi_${crypto.randomBytes(10).toString('hex')}`;

      if (userEmail) {
        await fulfillProUpgrade({
          userEmail,
          userName,
          userRole,
          planName,
          amount,
          currency: (session.currency || 'usd').toUpperCase(),
          stripeSessionId: session.id,
          transactionId,
        });
      }
    }
  }
}

router.get('/my', verifyToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const items = await db.payments.find(
      (p) => p.userEmail.toLowerCase() === req.user!.email.toLowerCase(),
    );
    items.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
