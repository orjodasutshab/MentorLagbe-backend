import { Router } from 'express';
import { z } from 'zod';
import { generateId, getDb } from '../db.ts';
import { verifyToken, type AuthenticatedRequest } from '../middleware/auth.ts';
import { createNotification } from '../utils/notifications.ts';

const router = Router();
router.use(verifyToken);

const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(1000),
});

// List conversation threads + available contacts (for easy starting of new chats)
router.get('/threads', async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const myId = req.user!._id;
    const allMessages = await db.messages.find(
      (m) => m.senderId === myId || m.recipientId === myId,
    );
    allMessages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const threadMap = new Map<
      string,
      {
        partnerId: string;
        partnerName: string;
        partnerRole: string;
        partnerImage: string;
        lastMessage: string;
        lastAt: string;
        unreadCount: number;
      }
    >();

    for (const msg of allMessages) {
      const isMeSender = msg.senderId === myId;
      const partnerId = isMeSender ? msg.recipientId : msg.senderId;
      const existing = threadMap.get(partnerId);
      const isUnread = !isMeSender && !msg.read;

      if (!existing) {
        threadMap.set(partnerId, {
          partnerId,
          partnerName: isMeSender ? msg.recipientName : msg.senderName,
          partnerRole: isMeSender ? msg.recipientRole : msg.senderRole,
          partnerImage: isMeSender ? msg.recipientImage : msg.senderImage,
          lastMessage: msg.body,
          lastAt: msg.createdAt,
          unreadCount: isUnread ? 1 : 0,
        });
      } else if (isUnread) {
        existing.unreadCount += 1;
      }
    }

    // Provide directory contacts (tutors for students, applicants/students for tutors)
    // Students can start chats with tutors and tutors with students; admins can reach everyone.
    // Nobody gets the full user directory.
    const me = req.user!;
    const users = await db.users.find(
      (u) =>
        u._id !== myId &&
        u.role !== 'admin' &&
        (me.role === 'admin' || (me.role === 'student' ? u.role === 'tutor' : u.role === 'student')),
    );
    const contacts = users.slice(0, 300).map((u) => ({
      _id: u._id,
      name: u.name,
      role: u.role,
      image: u.image,
      plan: u.plan,
    }));

    res.json({
      threads: Array.from(threadMap.values()),
      contacts,
    });
  } catch (err) {
    next(err);
  }
});

// Read full conversation with a partner & mark incoming as read
router.get('/thread/:partnerId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const db = await getDb();
    const myId = req.user!._id;
    const partnerId = req.params.partnerId;

    const partner = await db.users.findOne((u) => u._id === partnerId);
    if (!partner) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    await db.messages.updateMany(
      (m) => m.senderId === partnerId && m.recipientId === myId && !m.read,
      (m) => ({ ...m, read: true }),
    );

    const messages = await db.messages.find(
      (m) =>
        (m.senderId === myId && m.recipientId === partnerId) ||
        (m.senderId === partnerId && m.recipientId === myId),
    );
    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    res.json({
      partner: {
        _id: partner._id,
        name: partner.name,
        role: partner.role,
        image: partner.image,
        plan: partner.plan,
      },
      messages,
    });
  } catch (err) {
    next(err);
  }
});

// Send message to partner
router.post('/thread/:partnerId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Message body required.' });
      return;
    }

    const myId = req.user!._id;
    const partnerId = req.params.partnerId;
    if (partnerId === myId) {
      res.status(400).json({ error: 'You cannot send messages to yourself.' });
      return;
    }

    const db = await getDb();
    const partner = await db.users.findOne((u) => u._id === partnerId);
    if (!partner) {
      res.status(404).json({ error: 'Recipient not found.' });
      return;
    }

    const me = req.user!;
    const isOppositeRole =
      (me.role === 'student' && partner.role === 'tutor') ||
      (me.role === 'tutor' && partner.role === 'student');
    const hasMessagedMeFirst = await db.messages.findOne(
      (m) => m.senderId === partner._id && m.recipientId === me._id,
    );
    if (me.role !== 'admin' && !isOppositeRole && !hasMessagedMeFirst) {
      res.status(403).json({
        error: 'You can only message tutors (as a student) or students (as a tutor), or reply to someone who wrote to you.',
      });
      return;
    }

    const created = await db.messages.insertOne({
      _id: `msg_${generateId()}`,
      senderId: req.user!._id,
      senderName: req.user!.name,
      senderRole: req.user!.role,
      senderImage: req.user!.image,
      recipientId: partner._id,
      recipientName: partner.name,
      recipientRole: partner.role,
      recipientImage: partner.image,
      body: parsed.data.body,
      read: false,
      createdAt: new Date().toISOString(),
    });

    await createNotification(db, {
      userEmail: partner.email,
      title: `New message from ${req.user!.name}`,
      message: parsed.data.body.slice(0, 110),
      type: 'message',
      link: `/dashboard/messages?partner=${encodeURIComponent(req.user!._id)}`,
    });

    res.status(201).json({ message: created });
  } catch (err) {
    next(err);
  }
});

export default router;
