import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MongoClient, Db, Collection, type Filter, type Sort } from 'mongodb';
import type {
  UserDoc,
  TuitionDoc,
  ApplicationDoc,
  PaymentDoc,
  AuthSessionDoc,
  ResourceDoc,
  TutorRequestDoc,
  MessageDoc,
  NotificationDoc,
  QuizAttemptDoc,
  CustomQuizDoc,
  DailyQuizProgressDoc,
  DbSchema,
} from './types.ts';

export type CollectionName = keyof DbSchema;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BACKEND_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'mentorlagbe.db.json');

export function generateId(): string {
  return crypto.randomBytes(12).toString('hex');
}

/** True for MongoDB E11000 and for the local store's DUPLICATE_* errors. */
export function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 11000) return true;
  return typeof e.message === 'string' && e.message.startsWith('DUPLICATE_');
}

export interface TuitionQueryOptions {
  search?: string;
  subject?: string;
  classLevel?: string;
  mode?: string;
  maxFee?: number;
  sort?: string;
  page: number;
  limit: number;
}

class LocalCollection<T extends { _id: string }> {
  constructor(
    private readonly name: CollectionName,
    private readonly store: LocalStore,
  ) {}

  private list(): T[] {
    return this.store.read()[this.name] as unknown as T[];
  }

  private save(items: T[]): void {
    const data = this.store.read();
    (data[this.name] as unknown as T[]) = items;
    this.store.write(data);
  }

  async findAll(): Promise<T[]> {
    return [...this.list()];
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    return this.list().filter(predicate);
  }

  async findOne(predicate: (item: T) => boolean): Promise<T | null> {
    return this.list().find(predicate) ?? null;
  }

  async count(predicate?: (item: T) => boolean): Promise<number> {
    const items = this.list();
    return predicate ? items.filter(predicate).length : items.length;
  }

  async findById(id: string): Promise<T | null> {
    return this.list().find((item) => item._id === id) ?? null;
  }

  async findByField(field: string, value: unknown): Promise<T | null> {
    return (
      this.list().find((item) => (item as unknown as Record<string, unknown>)[field] === value) ?? null
    );
  }

  /** Atomic numeric increment. Returns null if the doc is missing or `min` would be violated. */
  async inc(id: string, field: string, delta: number, opts?: { min?: number }): Promise<T | null> {
    const items = this.list();
    const idx = items.findIndex((item) => item._id === id);
    if (idx === -1) return null;
    const current = Number((items[idx] as unknown as Record<string, unknown>)[field] ?? 0);
    const next = current + delta;
    if (opts?.min !== undefined && next < opts.min) return null;
    items[idx] = { ...items[idx], [field]: next };
    this.save(items);
    return items[idx];
  }

  /** Atomically add `value` to an array field only if it is not already there. */
  async claimOnce(id: string, field: string, value: string): Promise<boolean> {
    const items = this.list();
    const idx = items.findIndex((item) => item._id === id);
    if (idx === -1) return false;
    const current = ((items[idx] as unknown as Record<string, unknown>)[field] as string[] | undefined) ?? [];
    if (current.includes(value)) return false;
    items[idx] = { ...items[idx], [field]: [...current, value] };
    this.save(items);
    return true;
  }

  /** Compare-and-swap: replace the doc only if every `expected` field still matches. */
  async replaceIfUnchanged(id: string, expected: Record<string, unknown>, next: T): Promise<boolean> {
    const items = this.list();
    const idx = items.findIndex((item) => item._id === id);
    if (idx === -1) return false;
    const current = items[idx] as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(expected)) {
      if ((current[k] ?? null) !== (v ?? null)) return false;
    }
    items[idx] = next;
    this.save(items);
    return true;
  }

  async insertOne(doc: T): Promise<T> {
    const items = this.list();
    if (this.name === 'users') {
      const user = doc as unknown as UserDoc;
      if (items.some((u) => (u as unknown as UserDoc).email.toLowerCase() === user.email.toLowerCase())) {
        throw new Error('DUPLICATE_EMAIL');
      }
    }
    if (this.name === 'applications') {
      const app = doc as unknown as ApplicationDoc;
      if (
        items.some(
          (a) =>
            (a as unknown as ApplicationDoc).tuitionId === app.tuitionId &&
            (a as unknown as ApplicationDoc).studentEmail.toLowerCase() === app.studentEmail.toLowerCase(),
        )
      ) {
        throw new Error('DUPLICATE_APPLICATION');
      }
    }
    if (this.name === 'payments') {
      const pay = doc as unknown as PaymentDoc;
      if (
        items.some(
          (p) =>
            (p as unknown as PaymentDoc).stripeSessionId === pay.stripeSessionId ||
            (p as unknown as PaymentDoc).transactionId === pay.transactionId,
        )
      ) {
        throw new Error('DUPLICATE_PAYMENT');
      }
    }
    items.push(doc);
    this.save(items);
    return doc;
  }

  async updateOne(predicate: (item: T) => boolean, updater: (item: T) => T): Promise<T | null> {
    const items = this.list();
    const idx = items.findIndex(predicate);
    if (idx === -1) return null;
    items[idx] = updater(items[idx]);
    this.save(items);
    return items[idx];
  }

  async updateMany(predicate: (item: T) => boolean, updater: (item: T) => T): Promise<number> {
    const items = this.list();
    let count = 0;
    const updated = items.map((item) => {
      if (predicate(item)) {
        count++;
        return updater(item);
      }
      return item;
    });
    if (count > 0) this.save(updated);
    return count;
  }

  async deleteOne(predicate: (item: T) => boolean): Promise<boolean> {
    const items = this.list();
    const idx = items.findIndex(predicate);
    if (idx === -1) return false;
    items.splice(idx, 1);
    this.save(items);
    return true;
  }

  async deleteMany(predicate: (item: T) => boolean): Promise<number> {
    const items = this.list();
    const next = items.filter((item) => !predicate(item));
    const removed = items.length - next.length;
    if (removed > 0) this.save(next);
    return removed;
  }
}

class LocalStore {
  private cache: DbSchema | null = null;

  private ensureFile(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial: DbSchema = {
        users: [],
        tuitions: [],
        applications: [],
        payments: [],
        auth_sessions: [],
        resources: [],
        tutor_requests: [],
        messages: [],
        notifications: [],
        quiz_attempts: [],
        custom_quizzes: [],
        quiz_daily_progress: [],
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  read(): DbSchema {
    if (this.cache) return this.cache;
    this.ensureFile();
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DbSchema>;
    this.cache = {
      users: parsed.users || [],
      tuitions: parsed.tuitions || [],
      applications: parsed.applications || [],
      payments: parsed.payments || [],
      auth_sessions: parsed.auth_sessions || [],
      resources: parsed.resources || [],
      tutor_requests: parsed.tutor_requests || [],
      messages: parsed.messages || [],
      notifications: parsed.notifications || [],
      quiz_attempts: parsed.quiz_attempts || [],
      custom_quizzes: parsed.custom_quizzes || [],
      quiz_daily_progress: parsed.quiz_daily_progress || [],
    };
    return this.cache;
  }

  write(data: DbSchema): void {
    this.ensureFile();
    this.cache = data;
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }
}

class MongoCollectionWrapper<T extends { _id: string }> {
  constructor(public readonly col: Collection<T>) {}

  async findAll(): Promise<T[]> {
    return this.col.find({}).toArray() as Promise<T[]>;
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    const all = (await this.col.find({}).toArray()) as T[];
    return all.filter(predicate);
  }

  async findOne(predicate: (item: T) => boolean): Promise<T | null> {
    const all = (await this.col.find({}).toArray()) as T[];
    return all.find(predicate) ?? null;
  }

  async count(predicate?: (item: T) => boolean): Promise<number> {
    if (!predicate) return this.col.countDocuments();
    const all = (await this.col.find({}).toArray()) as T[];
    return all.filter(predicate).length;
  }

  async findById(id: string): Promise<T | null> {
    return (await this.col.findOne({ _id: id } as never)) as T | null;
  }

  async findByField(field: string, value: unknown): Promise<T | null> {
    return (await this.col.findOne({ [field]: value } as never)) as T | null;
  }

  /** Atomic $inc. Returns null if the doc is missing or `min` would be violated. */
  async inc(id: string, field: string, delta: number, opts?: { min?: number }): Promise<T | null> {
    const filter: Record<string, unknown> = { _id: id };
    if (opts?.min !== undefined) {
      filter[field] = { $gte: opts.min - delta };
    }
    const result = await this.col.findOneAndUpdate(
      filter as never,
      { $inc: { [field]: delta } } as never,
      { returnDocument: 'after' },
    );
    return (result as T | null) ?? null;
  }

  /** Atomic $addToSet that reports whether the value was newly added. */
  async claimOnce(id: string, field: string, value: string): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: id, [field]: { $ne: value } } as never,
      { $addToSet: { [field]: value } } as never,
    );
    return res.modifiedCount === 1;
  }

  /** Compare-and-swap: replace only if every `expected` field still matches in the database. */
  async replaceIfUnchanged(id: string, expected: Record<string, unknown>, next: T): Promise<boolean> {
    const filter: Record<string, unknown> = { _id: id };
    for (const [k, v] of Object.entries(expected)) {
      filter[k] = v === undefined ? null : v;
    }
    const res = await this.col.replaceOne(filter as never, next as never);
    return res.matchedCount === 1;
  }

  async insertOne(doc: T): Promise<T> {
    await this.col.insertOne(doc as never);
    return doc;
  }

  async updateOne(predicate: (item: T) => boolean, updater: (item: T) => T): Promise<T | null> {
    const found = await this.findOne(predicate);
    if (!found) return null;
    const next = updater(found);
    await this.col.replaceOne({ _id: found._id } as never, next as never);
    return next;
  }

  async updateMany(predicate: (item: T) => boolean, updater: (item: T) => T): Promise<number> {
    const matches = await this.find(predicate);
    for (const item of matches) {
      const next = updater(item);
      await this.col.replaceOne({ _id: item._id } as never, next as never);
    }
    return matches.length;
  }

  async deleteOne(predicate: (item: T) => boolean): Promise<boolean> {
    const found = await this.findOne(predicate);
    if (!found) return false;
    const res = await this.col.deleteOne({ _id: found._id } as never);
    return res.deletedCount > 0;
  }

  async deleteMany(predicate: (item: T) => boolean): Promise<number> {
    const matches = await this.find(predicate);
    if (matches.length === 0) return 0;
    const ids = matches.map((m) => m._id);
    const res = await this.col.deleteMany({ _id: { $in: ids } } as never);
    return res.deletedCount;
  }
}

export async function queryApprovedTuitions(
  db: DatabaseHandle,
  opts: TuitionQueryOptions,
): Promise<{ items: TuitionDoc[]; total: number; page: number; totalPages: number }> {
  const {
    search = '',
    subject = '',
    classLevel = '',
    mode = '',
    maxFee,
    sort = 'latest',
    page,
    limit,
  } = opts;

  if (db.mode === 'mongodb' && db.mongoDb) {
    const col = db.mongoDb.collection<TuitionDoc>('tuitions');
    const filter: Filter<TuitionDoc> = {
      approvalStatus: 'approved',
      isActive: true,
    };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { title: regex },
        { subject: regex },
        { tutorName: regex },
        { location: regex },
        { description: regex },
      ];
    }
    if (subject && subject !== 'All') {
      filter.subject = new RegExp(`^${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (classLevel && classLevel !== 'All') {
      filter.classLevel = new RegExp(`^${classLevel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (mode && mode !== 'All') {
      filter.mode = new RegExp(`^${mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') as never;
    }
    if (typeof maxFee === 'number' && maxFee > 0) {
      filter.monthlyFee = { $lte: maxFee };
    }

    const sortDoc: Sort =
      sort === 'fee_asc'
        ? { monthlyFee: 1 }
        : sort === 'fee_desc'
          ? { monthlyFee: -1 }
          : { createdAt: -1 };

    const total = await col.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;

    const items = await col.find(filter).sort(sortDoc).skip(skip).limit(limit).toArray();
    return { items, total, page: safePage, totalPages };
  }

  let filtered = await db.tuitions.find(
    (t) => t.approvalStatus === 'approved' && t.isActive === true,
  );
  const q = search.toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.tutorName.toLowerCase().includes(q) ||
        t.location.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }
  if (subject && subject !== 'All') {
    filtered = filtered.filter((t) => t.subject.toLowerCase() === subject.toLowerCase());
  }
  if (classLevel && classLevel !== 'All') {
    filtered = filtered.filter((t) => t.classLevel.toLowerCase() === classLevel.toLowerCase());
  }
  if (mode && mode !== 'All') {
    filtered = filtered.filter((t) => t.mode.toLowerCase() === mode.toLowerCase());
  }
  if (typeof maxFee === 'number' && maxFee > 0) {
    filtered = filtered.filter((t) => t.monthlyFee <= maxFee);
  }

  if (sort === 'fee_asc') {
    filtered.sort((a, b) => a.monthlyFee - b.monthlyFee);
  } else if (sort === 'fee_desc') {
    filtered.sort((a, b) => b.monthlyFee - a.monthlyFee);
  } else {
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * limit;
  return { items: filtered.slice(skip, skip + limit), total, page: safePage, totalPages };
}

export interface DatabaseHandle {
  mode: 'mongodb' | 'local';
  users: LocalCollection<UserDoc> | MongoCollectionWrapper<UserDoc>;
  tuitions: LocalCollection<TuitionDoc> | MongoCollectionWrapper<TuitionDoc>;
  applications: LocalCollection<ApplicationDoc> | MongoCollectionWrapper<ApplicationDoc>;
  payments: LocalCollection<PaymentDoc> | MongoCollectionWrapper<PaymentDoc>;
  auth_sessions: LocalCollection<AuthSessionDoc> | MongoCollectionWrapper<AuthSessionDoc>;
  resources: LocalCollection<ResourceDoc> | MongoCollectionWrapper<ResourceDoc>;
  tutor_requests: LocalCollection<TutorRequestDoc> | MongoCollectionWrapper<TutorRequestDoc>;
  messages: LocalCollection<MessageDoc> | MongoCollectionWrapper<MessageDoc>;
  notifications: LocalCollection<NotificationDoc> | MongoCollectionWrapper<NotificationDoc>;
  quiz_attempts: LocalCollection<QuizAttemptDoc> | MongoCollectionWrapper<QuizAttemptDoc>;
  custom_quizzes: LocalCollection<CustomQuizDoc> | MongoCollectionWrapper<CustomQuizDoc>;
  quiz_daily_progress: LocalCollection<DailyQuizProgressDoc> | MongoCollectionWrapper<DailyQuizProgressDoc>;
  mongoDb?: Db;
}

let dbInstance: DatabaseHandle | null = null;
let mongoClientInstance: MongoClient | null = null;

export async function getDb(): Promise<DatabaseHandle> {
  if (dbInstance) return dbInstance;

  const isProd = process.env.NODE_ENV === 'production';
  const allowLocalInProd = process.env.ALLOW_LOCAL_DB_IN_PROD === 'true';
  const mongoUri = process.env.MONGODB_URI?.trim();

  if (isProd && !mongoUri && !allowLocalInProd) {
    throw new Error(
      '[DB] MONGODB_URI is required in production (set ALLOW_LOCAL_DB_IN_PROD=true only for single-node testing).',
    );
  }

  if (mongoUri) {
    try {
      const client = new MongoClient(mongoUri, {
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 20000,
      });
      await client.connect();
      mongoClientInstance = client;
      const dbName = process.env.MONGODB_DB_NAME?.trim() || 'mentorlagbe';
      const mongoDb = client.db(dbName);

      await mongoDb.collection('users').createIndex({ email: 1 }, { unique: true });
      await mongoDb.collection('users').createIndex({ role: 1 });
      await mongoDb
        .collection('tuitions')
        .createIndex({ approvalStatus: 1, isActive: 1, subject: 1, createdAt: -1 });
      await mongoDb.collection('tuitions').createIndex({ tutorEmail: 1, createdAt: -1 });
      await mongoDb
        .collection('applications')
        .createIndex({ tuitionId: 1, studentEmail: 1 }, { unique: true });
      await mongoDb.collection('payments').createIndex({ stripeSessionId: 1 }, { unique: true });
      await mongoDb.collection('payments').createIndex({ transactionId: 1 }, { unique: true });
      await mongoDb.collection('payments').createIndex({ userEmail: 1, paidAt: -1 });
      await mongoDb.collection('auth_sessions').createIndex({ tokenHash: 1 }, { unique: true });
      // TTL indexes only work on BSON Date fields, so sessions carry a Date copy in expiresAtDate.
      await mongoDb
        .collection('auth_sessions')
        .createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
      await mongoDb.collection('auth_sessions').createIndex({ userId: 1 });
      await mongoDb.collection('notifications').createIndex({ userEmail: 1, createdAt: -1 });
      await mongoDb.collection('messages').createIndex({ senderId: 1, recipientId: 1, createdAt: -1 });
      await mongoDb.collection('quiz_daily_progress').createIndex({ userId: 1 }, { unique: true });

      dbInstance = {
        mode: 'mongodb',
        users: new MongoCollectionWrapper<UserDoc>(mongoDb.collection<UserDoc>('users')),
        tuitions: new MongoCollectionWrapper<TuitionDoc>(mongoDb.collection<TuitionDoc>('tuitions')),
        applications: new MongoCollectionWrapper<ApplicationDoc>(
          mongoDb.collection<ApplicationDoc>('applications'),
        ),
        payments: new MongoCollectionWrapper<PaymentDoc>(mongoDb.collection<PaymentDoc>('payments')),
        auth_sessions: new MongoCollectionWrapper<AuthSessionDoc>(
          mongoDb.collection<AuthSessionDoc>('auth_sessions'),
        ),
        resources: new MongoCollectionWrapper<ResourceDoc>(mongoDb.collection<ResourceDoc>('resources')),
        tutor_requests: new MongoCollectionWrapper<TutorRequestDoc>(
          mongoDb.collection<TutorRequestDoc>('tutor_requests'),
        ),
        messages: new MongoCollectionWrapper<MessageDoc>(mongoDb.collection<MessageDoc>('messages')),
        notifications: new MongoCollectionWrapper<NotificationDoc>(
          mongoDb.collection<NotificationDoc>('notifications'),
        ),
        quiz_attempts: new MongoCollectionWrapper<QuizAttemptDoc>(
          mongoDb.collection<QuizAttemptDoc>('quiz_attempts'),
        ),
        custom_quizzes: new MongoCollectionWrapper<CustomQuizDoc>(
          mongoDb.collection<CustomQuizDoc>('custom_quizzes'),
        ),
        quiz_daily_progress: new MongoCollectionWrapper<DailyQuizProgressDoc>(
          mongoDb.collection<DailyQuizProgressDoc>('quiz_daily_progress'),
        ),
        mongoDb,
      };
      console.log(`[DB] Connected to MongoDB database "${dbName}".`);
      return dbInstance;
    } catch (err) {
      if (isProd && !allowLocalInProd) {
        throw err;
      }
      console.warn('[DB] MongoDB unavailable, falling back to local persistent JSON store:', (err as Error).message);
    }
  }

  const store = new LocalStore();
  dbInstance = {
    mode: 'local',
    users: new LocalCollection<UserDoc>('users', store),
    tuitions: new LocalCollection<TuitionDoc>('tuitions', store),
    applications: new LocalCollection<ApplicationDoc>('applications', store),
    payments: new LocalCollection<PaymentDoc>('payments', store),
    auth_sessions: new LocalCollection<AuthSessionDoc>('auth_sessions', store),
    resources: new LocalCollection<ResourceDoc>('resources', store),
    tutor_requests: new LocalCollection<TutorRequestDoc>('tutor_requests', store),
    messages: new LocalCollection<MessageDoc>('messages', store),
    notifications: new LocalCollection<NotificationDoc>('notifications', store),
    quiz_attempts: new LocalCollection<QuizAttemptDoc>('quiz_attempts', store),
    custom_quizzes: new LocalCollection<CustomQuizDoc>('custom_quizzes', store),
    quiz_daily_progress: new LocalCollection<DailyQuizProgressDoc>('quiz_daily_progress', store),
  };
  console.log('[DB] Using local persistent JSON database store (backend/data/mentorlagbe.db.json).');
  return dbInstance;
}

export async function pingDb(): Promise<{ ok: boolean; mode: 'mongodb' | 'local' }> {
  const db = await getDb();
  if (db.mode === 'mongodb' && db.mongoDb) {
    try {
      await db.mongoDb.command({ ping: 1 });
      return { ok: true, mode: 'mongodb' };
    } catch {
      return { ok: false, mode: 'mongodb' };
    }
  }
  return { ok: true, mode: 'local' };
}

export async function closeDb(): Promise<void> {
  if (mongoClientInstance) {
    await mongoClientInstance.close();
    mongoClientInstance = null;
  }
  dbInstance = null;
}
