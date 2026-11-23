// src/app.ts
import express2 from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import fs3 from "fs";
import path3 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
import { toNodeHandler } from "better-auth/node";

// src/config/env.ts
var PLACEHOLDER_TOKENS = [
  "replace-with",
  "change-me",
  "changeme",
  "placeholder",
  "your_",
  "example_secret"
];
function isProduction() {
  return process.env.NODE_ENV === "production";
}
function isPlaceholderValue(value) {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return PLACEHOLDER_TOKENS.some((token) => lower.includes(token));
}
function isStrongSecret(value, minLength = 32) {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  return !isPlaceholderValue(trimmed);
}
function normalizeOrigin(raw) {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}
function getAllowedOrigins() {
  const candidates = [];
  for (const key of ["CLIENT_URL", "APP_URL", "BETTER_AUTH_URL"]) {
    const val = process.env[key]?.trim();
    if (val) candidates.push(val);
  }
  const extra = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      if (part.trim()) candidates.push(part.trim());
    }
  }
  if (!isProduction()) {
    candidates.push(
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5000",
      "http://127.0.0.1:5000",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    );
  }
  const normalized = /* @__PURE__ */ new Set();
  for (const item of candidates) {
    const norm = normalizeOrigin(item);
    if (norm) normalized.add(norm);
  }
  return Array.from(normalized);
}
function isOriginAllowed(origin, requestHost) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const allowed = getAllowedOrigins();
  if (allowed.includes(normalized)) {
    return true;
  }
  if (requestHost) {
    try {
      const originHost = new URL(normalized).host.toLowerCase();
      if (originHost === requestHost.trim().toLowerCase()) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}
function getPrimaryAppOrigin(requestOrigin, requestHost) {
  if (requestOrigin && isOriginAllowed(requestOrigin, requestHost)) {
    const norm = normalizeOrigin(requestOrigin);
    if (norm) return norm;
  }
  const configured = normalizeOrigin(process.env.CLIENT_URL || "") || normalizeOrigin(process.env.APP_URL || "") || normalizeOrigin(process.env.BETTER_AUTH_URL || "");
  if (configured) return configured;
  if (requestHost) {
    const proto = isProduction() ? "https" : "http";
    return `${proto}://${requestHost}`;
  }
  return "http://localhost:3000";
}
function validateRuntimeEnvironment() {
  const prod = isProduction();
  const warnings = [];
  const errors = [];
  const jwtSecret = process.env.JWT_SECRET?.trim();
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET?.trim();
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (prod) {
    if (!isStrongSecret(jwtSecret, 32)) {
      errors.push("JWT_SECRET must be at least 32 non-placeholder characters in production.");
    }
    if (betterAuthSecret && !isStrongSecret(betterAuthSecret, 32)) {
      errors.push("BETTER_AUTH_SECRET must be at least 32 non-placeholder characters when set.");
    }
    if (!mongoUri && process.env.ALLOW_LOCAL_DB_IN_PROD !== "true") {
      errors.push("MONGODB_URI is required in production unless ALLOW_LOCAL_DB_IN_PROD=true.");
    }
  } else {
    if (!jwtSecret || isPlaceholderValue(jwtSecret)) {
      warnings.push("Using ephemeral development JWT secret fallback.");
    }
  }
  for (const urlVar of ["APP_URL", "CLIENT_URL", "BETTER_AUTH_URL"]) {
    const val = process.env[urlVar]?.trim();
    if (val && !normalizeOrigin(val)) {
      errors.push(`${urlVar} must be a valid http:// or https:// URL.`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:
- ${errors.join("\n- ")}`);
  }
  for (const w of warnings) {
    console.warn(`[Env] ${w}`);
  }
}

// src/db.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var BACKEND_ROOT = path.resolve(__dirname, "..");
var DATA_DIR = path.join(BACKEND_ROOT, "data");
var DB_FILE = path.join(DATA_DIR, "mentorlagbe.db.json");
function generateId() {
  return crypto.randomBytes(12).toString("hex");
}
function isDuplicateKeyError(err) {
  if (!err || typeof err !== "object") return false;
  const e = err;
  if (e.code === 11e3) return true;
  return typeof e.message === "string" && e.message.startsWith("DUPLICATE_");
}
var LocalCollection = class {
  constructor(name, store) {
    this.name = name;
    this.store = store;
  }
  name;
  store;
  list() {
    return this.store.read()[this.name];
  }
  save(items) {
    const data = this.store.read();
    data[this.name] = items;
    this.store.write(data);
  }
  async findAll() {
    return [...this.list()];
  }
  async find(predicate) {
    return this.list().filter(predicate);
  }
  async findOne(predicate) {
    return this.list().find(predicate) ?? null;
  }
  async count(predicate) {
    const items = this.list();
    return predicate ? items.filter(predicate).length : items.length;
  }
  async findById(id) {
    return this.list().find((item) => item._id === id) ?? null;
  }
  async findByField(field, value) {
    return this.list().find((item) => item[field] === value) ?? null;
  }
  /** Atomic numeric increment. Returns null if the doc is missing or `min` would be violated. */
  async inc(id, field, delta, opts) {
    const items = this.list();
    const idx = items.findIndex((item) => item._id === id);
    if (idx === -1) return null;
    const current = Number(items[idx][field] ?? 0);
    const next = current + delta;
    if (opts?.min !== void 0 && next < opts.min) return null;
    items[idx] = { ...items[idx], [field]: next };
    this.save(items);
    return items[idx];
  }
  /** Atomically add `value` to an array field only if it is not already there. */
  async claimOnce(id, field, value) {
    const items = this.list();
    const idx = items.findIndex((item) => item._id === id);
    if (idx === -1) return false;
    const current = items[idx][field] ?? [];
    if (current.includes(value)) return false;
    items[idx] = { ...items[idx], [field]: [...current, value] };
    this.save(items);
    return true;
  }
  /** Compare-and-swap: replace the doc only if every `expected` field still matches. */
  async replaceIfUnchanged(id, expected, next) {
    const items = this.list();
    const idx = items.findIndex((item) => item._id === id);
    if (idx === -1) return false;
    const current = items[idx];
    for (const [k, v] of Object.entries(expected)) {
      if ((current[k] ?? null) !== (v ?? null)) return false;
    }
    items[idx] = next;
    this.save(items);
    return true;
  }
  async insertOne(doc) {
    const items = this.list();
    if (this.name === "users") {
      const user = doc;
      if (items.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
        throw new Error("DUPLICATE_EMAIL");
      }
    }
    if (this.name === "applications") {
      const app = doc;
      if (items.some(
        (a) => a.tuitionId === app.tuitionId && a.studentEmail.toLowerCase() === app.studentEmail.toLowerCase()
      )) {
        throw new Error("DUPLICATE_APPLICATION");
      }
    }
    if (this.name === "payments") {
      const pay = doc;
      if (items.some(
        (p) => p.stripeSessionId === pay.stripeSessionId || p.transactionId === pay.transactionId
      )) {
        throw new Error("DUPLICATE_PAYMENT");
      }
    }
    items.push(doc);
    this.save(items);
    return doc;
  }
  async updateOne(predicate, updater) {
    const items = this.list();
    const idx = items.findIndex(predicate);
    if (idx === -1) return null;
    items[idx] = updater(items[idx]);
    this.save(items);
    return items[idx];
  }
  async updateMany(predicate, updater) {
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
  async deleteOne(predicate) {
    const items = this.list();
    const idx = items.findIndex(predicate);
    if (idx === -1) return false;
    items.splice(idx, 1);
    this.save(items);
    return true;
  }
  async deleteMany(predicate) {
    const items = this.list();
    const next = items.filter((item) => !predicate(item));
    const removed = items.length - next.length;
    if (removed > 0) this.save(next);
    return removed;
  }
};
var LocalStore = class {
  cache = null;
  ensureFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
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
        quiz_daily_progress: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf-8");
    }
  }
  read() {
    if (this.cache) return this.cache;
    this.ensureFile();
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw);
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
      quiz_daily_progress: parsed.quiz_daily_progress || []
    };
    return this.cache;
  }
  write(data) {
    this.ensureFile();
    this.cache = data;
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  }
};
var MongoCollectionWrapper = class {
  constructor(col) {
    this.col = col;
  }
  col;
  async findAll() {
    return this.col.find({}).toArray();
  }
  async find(predicate) {
    const all = await this.col.find({}).toArray();
    return all.filter(predicate);
  }
  async findOne(predicate) {
    const all = await this.col.find({}).toArray();
    return all.find(predicate) ?? null;
  }
  async count(predicate) {
    if (!predicate) return this.col.countDocuments();
    const all = await this.col.find({}).toArray();
    return all.filter(predicate).length;
  }
  async findById(id) {
    return await this.col.findOne({ _id: id });
  }
  async findByField(field, value) {
    return await this.col.findOne({ [field]: value });
  }
  /** Atomic $inc. Returns null if the doc is missing or `min` would be violated. */
  async inc(id, field, delta, opts) {
    const filter = { _id: id };
    if (opts?.min !== void 0) {
      filter[field] = { $gte: opts.min - delta };
    }
    const result = await this.col.findOneAndUpdate(
      filter,
      { $inc: { [field]: delta } },
      { returnDocument: "after" }
    );
    return result ?? null;
  }
  /** Atomic $addToSet that reports whether the value was newly added. */
  async claimOnce(id, field, value) {
    const res = await this.col.updateOne(
      { _id: id, [field]: { $ne: value } },
      { $addToSet: { [field]: value } }
    );
    return res.modifiedCount === 1;
  }
  /** Compare-and-swap: replace only if every `expected` field still matches in the database. */
  async replaceIfUnchanged(id, expected, next) {
    const filter = { _id: id };
    for (const [k, v] of Object.entries(expected)) {
      filter[k] = v === void 0 ? null : v;
    }
    const res = await this.col.replaceOne(filter, next);
    return res.matchedCount === 1;
  }
  async insertOne(doc) {
    await this.col.insertOne(doc);
    return doc;
  }
  async updateOne(predicate, updater) {
    const found = await this.findOne(predicate);
    if (!found) return null;
    const next = updater(found);
    await this.col.replaceOne({ _id: found._id }, next);
    return next;
  }
  async updateMany(predicate, updater) {
    const matches = await this.find(predicate);
    for (const item of matches) {
      const next = updater(item);
      await this.col.replaceOne({ _id: item._id }, next);
    }
    return matches.length;
  }
  async deleteOne(predicate) {
    const found = await this.findOne(predicate);
    if (!found) return false;
    const res = await this.col.deleteOne({ _id: found._id });
    return res.deletedCount > 0;
  }
  async deleteMany(predicate) {
    const matches = await this.find(predicate);
    if (matches.length === 0) return 0;
    const ids = matches.map((m) => m._id);
    const res = await this.col.deleteMany({ _id: { $in: ids } });
    return res.deletedCount;
  }
};
async function queryApprovedTuitions(db, opts) {
  const {
    search = "",
    subject = "",
    classLevel = "",
    mode = "",
    maxFee,
    sort = "latest",
    page,
    limit
  } = opts;
  if (db.mode === "mongodb" && db.mongoDb) {
    const col = db.mongoDb.collection("tuitions");
    const filter = {
      approvalStatus: "approved",
      isActive: true
    };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter.$or = [
        { title: regex },
        { subject: regex },
        { tutorName: regex },
        { location: regex },
        { description: regex }
      ];
    }
    if (subject && subject !== "All") {
      filter.subject = new RegExp(`^${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }
    if (classLevel && classLevel !== "All") {
      filter.classLevel = new RegExp(`^${classLevel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }
    if (mode && mode !== "All") {
      filter.mode = new RegExp(`^${mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }
    if (typeof maxFee === "number" && maxFee > 0) {
      filter.monthlyFee = { $lte: maxFee };
    }
    const sortDoc = sort === "fee_asc" ? { monthlyFee: 1 } : sort === "fee_desc" ? { monthlyFee: -1 } : { createdAt: -1 };
    const total2 = await col.countDocuments(filter);
    const totalPages2 = Math.max(1, Math.ceil(total2 / limit));
    const safePage2 = Math.min(page, totalPages2);
    const skip2 = (safePage2 - 1) * limit;
    const items = await col.find(filter).sort(sortDoc).skip(skip2).limit(limit).toArray();
    return { items, total: total2, page: safePage2, totalPages: totalPages2 };
  }
  let filtered = await db.tuitions.find(
    (t) => t.approvalStatus === "approved" && t.isActive === true
  );
  const q = search.toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (t) => t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.tutorName.toLowerCase().includes(q) || t.location.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }
  if (subject && subject !== "All") {
    filtered = filtered.filter((t) => t.subject.toLowerCase() === subject.toLowerCase());
  }
  if (classLevel && classLevel !== "All") {
    filtered = filtered.filter((t) => t.classLevel.toLowerCase() === classLevel.toLowerCase());
  }
  if (mode && mode !== "All") {
    filtered = filtered.filter((t) => t.mode.toLowerCase() === mode.toLowerCase());
  }
  if (typeof maxFee === "number" && maxFee > 0) {
    filtered = filtered.filter((t) => t.monthlyFee <= maxFee);
  }
  if (sort === "fee_asc") {
    filtered.sort((a, b) => a.monthlyFee - b.monthlyFee);
  } else if (sort === "fee_desc") {
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
var dbInstance = null;
var mongoClientInstance = null;
async function getDb() {
  if (dbInstance) return dbInstance;
  const isProd = process.env.NODE_ENV === "production";
  const allowLocalInProd = process.env.ALLOW_LOCAL_DB_IN_PROD === "true";
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (isProd && !mongoUri && !allowLocalInProd) {
    throw new Error(
      "[DB] MONGODB_URI is required in production (set ALLOW_LOCAL_DB_IN_PROD=true only for single-node testing)."
    );
  }
  if (mongoUri) {
    try {
      const client = new MongoClient(mongoUri, {
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5e3,
        socketTimeoutMS: 2e4
      });
      await client.connect();
      mongoClientInstance = client;
      const dbName = process.env.MONGODB_DB_NAME?.trim() || "mentorlagbe";
      const mongoDb = client.db(dbName);
      await mongoDb.collection("users").createIndex({ email: 1 }, { unique: true });
      await mongoDb.collection("users").createIndex({ role: 1 });
      await mongoDb.collection("tuitions").createIndex({ approvalStatus: 1, isActive: 1, subject: 1, createdAt: -1 });
      await mongoDb.collection("tuitions").createIndex({ tutorEmail: 1, createdAt: -1 });
      await mongoDb.collection("applications").createIndex({ tuitionId: 1, studentEmail: 1 }, { unique: true });
      await mongoDb.collection("payments").createIndex({ stripeSessionId: 1 }, { unique: true });
      await mongoDb.collection("payments").createIndex({ transactionId: 1 }, { unique: true });
      await mongoDb.collection("payments").createIndex({ userEmail: 1, paidAt: -1 });
      await mongoDb.collection("auth_sessions").createIndex({ tokenHash: 1 }, { unique: true });
      await mongoDb.collection("auth_sessions").createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
      await mongoDb.collection("auth_sessions").createIndex({ userId: 1 });
      await mongoDb.collection("notifications").createIndex({ userEmail: 1, createdAt: -1 });
      await mongoDb.collection("messages").createIndex({ senderId: 1, recipientId: 1, createdAt: -1 });
      await mongoDb.collection("quiz_daily_progress").createIndex({ userId: 1 }, { unique: true });
      dbInstance = {
        mode: "mongodb",
        users: new MongoCollectionWrapper(mongoDb.collection("users")),
        tuitions: new MongoCollectionWrapper(mongoDb.collection("tuitions")),
        applications: new MongoCollectionWrapper(
          mongoDb.collection("applications")
        ),
        payments: new MongoCollectionWrapper(mongoDb.collection("payments")),
        auth_sessions: new MongoCollectionWrapper(
          mongoDb.collection("auth_sessions")
        ),
        resources: new MongoCollectionWrapper(mongoDb.collection("resources")),
        tutor_requests: new MongoCollectionWrapper(
          mongoDb.collection("tutor_requests")
        ),
        messages: new MongoCollectionWrapper(mongoDb.collection("messages")),
        notifications: new MongoCollectionWrapper(
          mongoDb.collection("notifications")
        ),
        quiz_attempts: new MongoCollectionWrapper(
          mongoDb.collection("quiz_attempts")
        ),
        custom_quizzes: new MongoCollectionWrapper(
          mongoDb.collection("custom_quizzes")
        ),
        quiz_daily_progress: new MongoCollectionWrapper(
          mongoDb.collection("quiz_daily_progress")
        ),
        mongoDb
      };
      console.log(`[DB] Connected to MongoDB database "${dbName}".`);
      return dbInstance;
    } catch (err) {
      if (isProd && !allowLocalInProd) {
        throw err;
      }
      console.warn("[DB] MongoDB unavailable, falling back to local persistent JSON store:", err.message);
    }
  }
  const store = new LocalStore();
  dbInstance = {
    mode: "local",
    users: new LocalCollection("users", store),
    tuitions: new LocalCollection("tuitions", store),
    applications: new LocalCollection("applications", store),
    payments: new LocalCollection("payments", store),
    auth_sessions: new LocalCollection("auth_sessions", store),
    resources: new LocalCollection("resources", store),
    tutor_requests: new LocalCollection("tutor_requests", store),
    messages: new LocalCollection("messages", store),
    notifications: new LocalCollection("notifications", store),
    quiz_attempts: new LocalCollection("quiz_attempts", store),
    custom_quizzes: new LocalCollection("custom_quizzes", store),
    quiz_daily_progress: new LocalCollection("quiz_daily_progress", store)
  };
  console.log("[DB] Using local persistent JSON database store (backend/data/mentorlagbe.db.json).");
  return dbInstance;
}
async function pingDb() {
  const db = await getDb();
  if (db.mode === "mongodb" && db.mongoDb) {
    try {
      await db.mongoDb.command({ ping: 1 });
      return { ok: true, mode: "mongodb" };
    } catch {
      return { ok: false, mode: "mongodb" };
    }
  }
  return { ok: true, mode: "local" };
}

// src/auth/betterAuth.ts
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer } from "better-auth/plugins/bearer";
import { jwt } from "better-auth/plugins/jwt";
import crypto2 from "crypto";
var devBetterAuthSecret = null;
function createBetterAuth(db) {
  const baseURL = process.env.BETTER_AUTH_URL?.trim() || process.env.APP_URL?.trim() || "http://localhost:3000";
  const configuredSecret = process.env.BETTER_AUTH_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (isProduction() && !isStrongSecret(configuredSecret, 32)) {
    throw new Error("BETTER_AUTH_SECRET or JWT_SECRET must be configured cleanly in production.");
  }
  if (!configuredSecret && !devBetterAuthSecret) {
    devBetterAuthSecret = crypto2.randomBytes(32).toString("hex");
  }
  const secret = configuredSecret || devBetterAuthSecret;
  const database = db.mode === "mongodb" && db.mongoDb ? mongodbAdapter(db.mongoDb) : memoryAdapter({
    ba_users: [],
    session: [],
    account: [],
    verification: [],
    jwks: []
  });
  return betterAuth({
    baseURL,
    basePath: "/api/better-auth",
    secret,
    database,
    user: {
      modelName: "ba_users",
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "student",
          input: false
        },
        plan: {
          type: "string",
          required: false,
          defaultValue: "free",
          input: false
        }
      }
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true
    },
    trustedOrigins: getAllowedOrigins(),
    plugins: [jwt(), bearer()]
  });
}
var authInstance = null;
async function getBetterAuth() {
  if (authInstance) return authInstance;
  const db = await getDb();
  authInstance = createBetterAuth(db);
  return authInstance;
}

// src/utils/seedData.ts
import bcrypt from "bcryptjs";
function daysAgoIso(days) {
  return new Date(Date.now() - days * 864e5).toISOString();
}
async function seedDatabaseIfEmpty(db) {
  const existingUsers = await db.users.count();
  if (existingUsers > 0) {
    return false;
  }
  const [adminHash, tutorHash, studentHash] = await Promise.all([
    bcrypt.hash("Admin@1234", 10),
    bcrypt.hash("Tutor@1234", 10),
    bcrypt.hash("Student@1234", 10)
  ]);
  const users = [
    {
      _id: "usr_admin_01",
      name: "Farhana Yasmin",
      email: "admin@mentorlagbe.com",
      image: "/api/assets/default-avatar.svg",
      role: "admin",
      phone: "+880 1711-000101",
      bio: "Platform Administrator overseeing tutor listing quality, student safety, and Stripe subscription operations.",
      plan: "pro",
      savedTuitionIds: [],
      passwordHash: adminHash,
      createdAt: daysAgoIso(45)
    },
    {
      _id: "usr_tutor_01",
      name: "Dr. Tanvir Ahmed",
      email: "tutor@mentorlagbe.com",
      image: "/api/assets/default-avatar.svg",
      role: "tutor",
      phone: "+880 1711-000202",
      bio: "BUET Physics & Higher Mathematics graduate with 8 years of HSC, A-Level, and Engineering Admission coaching experience.",
      plan: "pro",
      savedTuitionIds: [],
      passwordHash: tutorHash,
      createdAt: daysAgoIso(40)
    },
    {
      _id: "usr_tutor_02",
      name: "Nusrat Rahman",
      email: "nusrat.tutor@mentorlagbe.com",
      image: "/api/assets/default-avatar.svg",
      role: "tutor",
      phone: "+880 1711-000203",
      bio: "British Council trained IELTS Band 8.5 mentor & Cambridge O/A-Level English Literature specialist.",
      plan: "free",
      savedTuitionIds: [],
      passwordHash: tutorHash,
      createdAt: daysAgoIso(32)
    },
    {
      _id: "usr_tutor_03",
      name: "Mahmudul Hasan",
      email: "mahmud.tutor@mentorlagbe.com",
      image: "/api/assets/default-avatar.svg",
      role: "tutor",
      phone: "+880 1711-000204",
      bio: "Senior Software Engineer mentoring HSC ICT, Python Programming, TypeScript, and Chemistry cohorts.",
      plan: "pro",
      savedTuitionIds: [],
      passwordHash: tutorHash,
      createdAt: daysAgoIso(28)
    },
    {
      _id: "usr_student_01",
      name: "Rafiul Islam",
      email: "student@mentorlagbe.com",
      image: "/api/assets/default-avatar.svg",
      role: "student",
      phone: "+880 1811-000301",
      bio: "HSC Science student preparing for university engineering admission exams.",
      plan: "free",
      savedTuitionIds: ["tui_01", "tui_03"],
      passwordHash: studentHash,
      createdAt: daysAgoIso(22)
    },
    {
      _id: "usr_student_02",
      name: "Sadia Afrin",
      email: "sadia.student@mentorlagbe.com",
      image: "/api/assets/default-avatar.svg",
      role: "student",
      phone: "+880 1811-000302",
      bio: "IELTS Academic & A-Level candidate focused on structured writing and quantitative problem solving.",
      plan: "pro",
      savedTuitionIds: ["tui_02", "tui_04"],
      passwordHash: studentHash,
      createdAt: daysAgoIso(18)
    },
    {
      _id: "usr_student_03",
      name: "Arif Chowdhury",
      email: "arif.student@mentorlagbe.com",
      image: "/api/assets/default-avatar.svg",
      role: "student",
      phone: "+880 1811-000303",
      bio: "Class 9-10 student looking for foundational mathematics and programming guidance.",
      plan: "free",
      savedTuitionIds: ["tui_05"],
      passwordHash: studentHash,
      createdAt: daysAgoIso(14)
    }
  ];
  const tuitions = [
    {
      _id: "tui_01",
      title: "HSC Higher Mathematics & Calculus Mastery Cohort",
      subject: "Mathematics",
      classLevel: "Class 11-12",
      mode: "Online",
      location: "Dhaka (Remote Live)",
      monthlyFee: 3500,
      daysPerWeek: 4,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Structured Higher Mathematics batch covering differential & integral calculus, vectors, and coordinate geometry with weekly timed board exam mock tests.",
      tutorName: "Dr. Tanvir Ahmed",
      tutorEmail: "tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [
        {
          _id: "rev_01",
          studentName: "Rafiul Islam",
          studentEmail: "student@mentorlagbe.com",
          rating: 5,
          comment: "Clear step-by-step calculus derivations and helpful weekly problem sheets.",
          createdAt: daysAgoIso(4)
        }
      ],
      createdAt: daysAgoIso(20)
    },
    {
      _id: "tui_02",
      title: "IELTS Academic Band 8.0 Writing & Speaking Intensive",
      subject: "IELTS",
      classLevel: "IELTS / Admission",
      mode: "Online",
      location: "Remote Live",
      monthlyFee: 5e3,
      daysPerWeek: 3,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Line-by-line Task 1 & Task 2 essay evaluation, authentic mock speaking interviews, and reading speed strategies tailored for Band 7.5+ targets.",
      tutorName: "Nusrat Rahman",
      tutorEmail: "nusrat.tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "free",
      approvalStatus: "approved",
      isActive: true,
      reviews: [
        {
          _id: "rev_02",
          studentName: "Sadia Afrin",
          studentEmail: "sadia.student@mentorlagbe.com",
          rating: 5,
          comment: "Detailed essay rubrics helped me jump from 6.5 to 7.5 in writing.",
          createdAt: daysAgoIso(3)
        }
      ],
      createdAt: daysAgoIso(19)
    },
    {
      _id: "tui_03",
      title: "A-Level & HSC Physics Mechanics & Electromagnetism",
      subject: "Physics",
      classLevel: "Class 11-12",
      mode: "Offline",
      location: "Dhanmondi, Dhaka",
      monthlyFee: 6e3,
      daysPerWeek: 3,
      bannerImage: "/api/assets/default-banner.svg",
      description: "In-person small-group physics mentorship emphasizing conceptual derivations, circuit diagnostics, and past-paper structured problem solving.",
      tutorName: "Dr. Tanvir Ahmed",
      tutorEmail: "tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(17)
    },
    {
      _id: "tui_04",
      title: "Full-Stack Web & Python Programming Foundations",
      subject: "Programming",
      classLevel: "University / Skill Track",
      mode: "Online",
      location: "Remote Live",
      monthlyFee: 4500,
      daysPerWeek: 3,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Hands-on mentorship covering Python, data structures, Git workflows, and building full-stack TypeScript web apps from scratch.",
      tutorName: "Mahmudul Hasan",
      tutorEmail: "mahmud.tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(15)
    },
    {
      _id: "tui_05",
      title: "SSC Mathematics & General Science Foundation Batch",
      subject: "Mathematics",
      classLevel: "Class 9-10",
      mode: "Offline",
      location: "Uttara, Dhaka",
      monthlyFee: 3e3,
      daysPerWeek: 4,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Focused board exam preparation covering algebra, trigonometry, geometry proofs, and chapter-wise formative assessments.",
      tutorName: "Dr. Tanvir Ahmed",
      tutorEmail: "tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(13)
    },
    {
      _id: "tui_06",
      title: "Organic & Physical Chemistry Admission Prep",
      subject: "Chemistry",
      classLevel: "IELTS / Admission",
      mode: "Online",
      location: "Dhaka (Remote Live)",
      monthlyFee: 4e3,
      daysPerWeek: 3,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Reaction mechanisms, stoichiometry shortcuts, and rapid MCQ solving techniques for engineering and medical admission exams.",
      tutorName: "Mahmudul Hasan",
      tutorEmail: "mahmud.tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(11)
    },
    {
      _id: "tui_07",
      title: "Medical Admission Biology & Human Physiology",
      subject: "Biology",
      classLevel: "IELTS / Admission",
      mode: "Online",
      location: "Chattogram (Remote Live)",
      monthlyFee: 3200,
      daysPerWeek: 3,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Visual diagram walkthroughs, textbook line-by-line highlights, and high-yield retention quizzes for medical admission aspirants.",
      tutorName: "Mahmudul Hasan",
      tutorEmail: "mahmud.tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(9)
    },
    {
      _id: "tui_08",
      title: "O-Level English Language & Academic Essay Writing",
      subject: "English",
      classLevel: "Class 9-10",
      mode: "Offline",
      location: "Banani, Dhaka",
      monthlyFee: 5500,
      daysPerWeek: 2,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Strengthen comprehension, summary writing, and directed essay composition following Cambridge O-Level assessment rubrics.",
      tutorName: "Nusrat Rahman",
      tutorEmail: "nusrat.tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "free",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(8)
    },
    {
      _id: "tui_09",
      title: "HSC ICT C-Programming, HTML & Logic Gates Lab",
      subject: "ICT",
      classLevel: "Class 11-12",
      mode: "Online",
      location: "Remote Live",
      monthlyFee: 2500,
      daysPerWeek: 2,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Complete HSC ICT practical and creative question preparation covering number systems, boolean algebra, SQL, and C loops.",
      tutorName: "Mahmudul Hasan",
      tutorEmail: "mahmud.tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(7)
    },
    {
      _id: "tui_10",
      title: "Class 6-8 Mathematics & Logical Reasoning Home Tuition",
      subject: "Mathematics",
      classLevel: "Class 6-8",
      mode: "Offline",
      location: "Mirpur, Dhaka",
      monthlyFee: 4e3,
      daysPerWeek: 4,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Patient 1-on-1 foundational mentorship building arithmetic confidence, fractions, ratios, and early algebraic thinking.",
      tutorName: "Dr. Tanvir Ahmed",
      tutorEmail: "tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(6)
    },
    {
      _id: "tui_11",
      title: "Financial Accounting & Cost Ledger Coaching",
      subject: "Accounting",
      classLevel: "Class 11-12",
      mode: "Online",
      location: "Sylhet (Remote Live)",
      monthlyFee: 3e3,
      daysPerWeek: 3,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Clear walkthroughs of double-entry bookkeeping, trial balances, financial statements, and bank reconciliation statements.",
      tutorName: "Dr. Tanvir Ahmed",
      tutorEmail: "tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(5)
    },
    {
      _id: "tui_12",
      title: "Engineering Admission Physics & Higher Math Bootcamp",
      subject: "Physics",
      classLevel: "IELTS / Admission",
      mode: "Online",
      location: "Remote Live",
      monthlyFee: 6500,
      daysPerWeek: 4,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Intensive problem-solving bootcamp for BUET, CKRUET, and Dhaka University Ka-Unit engineering admission candidates.",
      tutorName: "Dr. Tanvir Ahmed",
      tutorEmail: "tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "approved",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(4)
    },
    {
      _id: "tui_13",
      title: "Class 9-10 Chemistry Practical & Bonding Workshop",
      subject: "Chemistry",
      classLevel: "Class 9-10",
      mode: "Offline",
      location: "Gulshan, Dhaka",
      monthlyFee: 4500,
      daysPerWeek: 3,
      bannerImage: "/api/assets/default-banner.svg",
      description: "Pending moderation example: hands-on periodic trends, chemical equations, and mole calculation mentoring for SSC students.",
      tutorName: "Mahmudul Hasan",
      tutorEmail: "mahmud.tutor@mentorlagbe.com",
      tutorImage: "/api/assets/default-avatar.svg",
      tutorPlan: "pro",
      approvalStatus: "pending",
      isActive: true,
      reviews: [],
      createdAt: daysAgoIso(1)
    }
  ];
  const applications = [
    {
      _id: "app_01",
      tuitionId: "tui_01",
      tuitionTitle: "HSC Higher Mathematics & Calculus Mastery Cohort",
      subject: "Mathematics",
      monthlyFee: 3500,
      tutorEmail: "tutor@mentorlagbe.com",
      tutorName: "Dr. Tanvir Ahmed",
      studentName: "Rafiul Islam",
      studentEmail: "student@mentorlagbe.com",
      studentPhone: "+880 1811-000301",
      preferredSchedule: "Sun, Tue, Thu \xB7 7:30 PM",
      studentNote: "Looking to strengthen integration and vector calculus before HSC board mocks.",
      status: "accepted",
      appliedAt: daysAgoIso(12)
    },
    {
      _id: "app_02",
      tuitionId: "tui_02",
      tuitionTitle: "IELTS Academic Band 8.0 Writing & Speaking Intensive",
      subject: "IELTS",
      monthlyFee: 5e3,
      tutorEmail: "nusrat.tutor@mentorlagbe.com",
      tutorName: "Nusrat Rahman",
      studentName: "Sadia Afrin",
      studentEmail: "sadia.student@mentorlagbe.com",
      studentPhone: "+880 1811-000302",
      preferredSchedule: "Mon, Wed, Fri \xB7 8:00 PM",
      studentNote: "Targeting Band 8.0 for fall university applications; need writing Task 2 feedback.",
      status: "accepted",
      appliedAt: daysAgoIso(10)
    },
    {
      _id: "app_03",
      tuitionId: "tui_04",
      tuitionTitle: "Full-Stack Web & Python Programming Foundations",
      subject: "Programming",
      monthlyFee: 4500,
      tutorEmail: "mahmud.tutor@mentorlagbe.com",
      tutorName: "Mahmudul Hasan",
      studentName: "Rafiul Islam",
      studentEmail: "student@mentorlagbe.com",
      studentPhone: "+880 1811-000301",
      preferredSchedule: "Fri, Sat \xB7 5:00 PM",
      studentNote: "Have basic Python syntax knowledge and want guided project mentorship.",
      status: "pending",
      appliedAt: daysAgoIso(2)
    },
    {
      _id: "app_04",
      tuitionId: "tui_05",
      tuitionTitle: "SSC Mathematics & General Science Foundation Batch",
      subject: "Mathematics",
      monthlyFee: 3e3,
      tutorEmail: "tutor@mentorlagbe.com",
      tutorName: "Dr. Tanvir Ahmed",
      studentName: "Arif Chowdhury",
      studentEmail: "arif.student@mentorlagbe.com",
      studentPhone: "+880 1811-000303",
      preferredSchedule: "Sat - Tue \xB7 4:30 PM",
      studentNote: "Need help with trigonometry and geometry proofs ahead of test exams.",
      status: "pending",
      appliedAt: daysAgoIso(1)
    }
  ];
  const payments = [
    {
      _id: "pay_01",
      userEmail: "tutor@mentorlagbe.com",
      userName: "Dr. Tanvir Ahmed",
      userRole: "tutor",
      planName: "Pro Tutor",
      amount: 15,
      currency: "USD",
      transactionId: "pi_seed_tutor_01",
      stripeSessionId: "cs_seed_tutor_01",
      paymentStatus: "paid",
      paidAt: daysAgoIso(25)
    },
    {
      _id: "pay_02",
      userEmail: "mahmud.tutor@mentorlagbe.com",
      userName: "Mahmudul Hasan",
      userRole: "tutor",
      planName: "Pro Tutor",
      amount: 15,
      currency: "USD",
      transactionId: "pi_seed_tutor_02",
      stripeSessionId: "cs_seed_tutor_02",
      paymentStatus: "paid",
      paidAt: daysAgoIso(21)
    },
    {
      _id: "pay_03",
      userEmail: "sadia.student@mentorlagbe.com",
      userName: "Sadia Afrin",
      userRole: "student",
      planName: "Pro Student",
      amount: 10,
      currency: "USD",
      transactionId: "pi_seed_student_01",
      stripeSessionId: "cs_seed_student_01",
      paymentStatus: "paid",
      paidAt: daysAgoIso(14)
    }
  ];
  for (const user of users) {
    await db.users.insertOne(user);
  }
  for (const tuition of tuitions) {
    await db.tuitions.insertOne(tuition);
  }
  for (const app of applications) {
    await db.applications.insertOne(app);
  }
  for (const pay of payments) {
    await db.payments.insertOne(pay);
  }
  console.log(
    `[Seed] Seeded ${users.length} users, ${tuitions.length} tuitions, ${applications.length} applications, ${payments.length} payments.`
  );
  return true;
}

// src/utils/extrasSeed.ts
function daysAgoIso2(days) {
  return new Date(Date.now() - days * 864e5).toISOString();
}
async function ensureExtrasSeeded(db) {
  const [resCount, reqCount, msgCount, ntfCount, customQuizCount] = await Promise.all([
    db.resources.count(),
    db.tutor_requests.count(),
    db.messages.count(),
    db.notifications.count(),
    db.custom_quizzes.count()
  ]);
  const demoUserDefaults = [
    {
      id: "usr_tutor_01",
      coins: 650,
      facebookUrl: "https://facebook.com/mentorlagbe",
      youtubeUrl: "https://youtube.com/@mentorlagbe"
    },
    {
      id: "usr_tutor_02",
      coins: 320,
      facebookUrl: "https://facebook.com/mentorlagbe"
    },
    {
      id: "usr_tutor_03",
      coins: 520,
      youtubeUrl: "https://youtube.com/@mentorlagbe"
    },
    { id: "usr_student_01", coins: 120 },
    { id: "usr_student_02", coins: 80 },
    { id: "usr_admin_01", coins: 500 }
  ];
  for (const d of demoUserDefaults) {
    const existing = await db.users.findOne((u) => u._id === d.id);
    if (existing && typeof existing.coins !== "number") {
      await db.users.updateOne(
        (u) => u._id === d.id,
        (u) => ({
          ...u,
          coins: d.coins,
          ...u.facebookUrl === void 0 && d.facebookUrl ? { facebookUrl: d.facebookUrl } : {},
          ...u.youtubeUrl === void 0 && d.youtubeUrl ? { youtubeUrl: d.youtubeUrl } : {}
        })
      );
    }
  }
  if (resCount === 0) {
    const resources = [
      {
        _id: "res_01",
        title: "HSC Higher Math Calculus & Integration Formula Sheet",
        category: "Formula Sheets",
        subject: "Mathematics",
        classLevel: "HSC / Class 11-12",
        summary: "Complete differentiation, definite integral identities, and differential equation shortcuts for board & admission tests.",
        contentPreview: "Includes 42 standard integration templates, substitution patterns, area-under-curve worked examples, and 15 BUET/DU past-paper drill problems with step-by-step solutions.",
        thumbnailUrl: "/api/assets/default-banner.svg",
        resourceUrl: "/tuitions?subject=Mathematics",
        accessLevel: "free",
        authorId: "usr_tutor_01",
        authorName: "Dr. Tanvir Ahmed",
        authorEmail: "tutor@mentorlagbe.com",
        approvalStatus: "approved",
        downloads: 418,
        createdAt: daysAgoIso2(14)
      },
      {
        _id: "res_02",
        title: "Mechanics, Electrostatics & Optics Revision Pack",
        category: "Lecture Notes",
        subject: "Physics",
        classLevel: "HSC / Class 11-12",
        summary: "Visual vector diagrams, Gauss law derivations, and ray-optics sign conventions condensed into a single revision pack.",
        contentPreview: "Covers Newton laws in non-inertial frames, capacitor energy density proofs, interference fringe width problems, and a 20-minute pre-exam checklist.",
        thumbnailUrl: "/api/assets/default-banner.svg",
        resourceUrl: "/tuitions?subject=Physics",
        accessLevel: "free",
        authorId: "usr_tutor_01",
        authorName: "Dr. Tanvir Ahmed",
        authorEmail: "tutor@mentorlagbe.com",
        approvalStatus: "approved",
        downloads: 309,
        createdAt: daysAgoIso2(12)
      },
      {
        _id: "res_03",
        title: "IELTS Writing Task 2 Band 8.0 Essay Blueprint",
        category: "Exam Guides",
        subject: "IELTS",
        classLevel: "IELTS / Admission",
        summary: "Structured paragraphing templates, lexical cohesion banks, and examiner rubric checklists for Academic Writing.",
        contentPreview: "Contains 6 annotated Band 8.0+ sample essays across Opinion, Discussion, and Problem-Solution prompts with sentence-level coherence breakdowns.",
        thumbnailUrl: "/api/assets/default-banner.svg",
        resourceUrl: "/tuitions?subject=IELTS",
        accessLevel: "free",
        authorId: "usr_tutor_02",
        authorName: "Nusrat Rahman",
        authorEmail: "nusrat.tutor@mentorlagbe.com",
        approvalStatus: "approved",
        downloads: 524,
        createdAt: daysAgoIso2(10)
      },
      {
        _id: "res_04",
        title: "Python, SQL & HSC ICT Logic Gate Workbook",
        category: "Coding Labs",
        subject: "Programming",
        classLevel: "HSC / University",
        summary: "Boolean algebra simplification, SQL join drills, and Python recursion patterns for ICT & CS students.",
        contentPreview: "Walks through Karnaugh maps, truth-table to NAND gate conversion, SQL aggregation queries, and 12 timed Python problem-solving challenges.",
        thumbnailUrl: "/api/assets/default-banner.svg",
        resourceUrl: "/tuitions?subject=Programming",
        accessLevel: "free",
        authorId: "usr_tutor_03",
        authorName: "Mahmudul Hasan",
        authorEmail: "mahmud.tutor@mentorlagbe.com",
        approvalStatus: "approved",
        downloads: 286,
        createdAt: daysAgoIso2(8)
      },
      {
        _id: "res_05",
        title: "Organic Chemistry Reaction Mechanisms Map (Pro Pack)",
        category: "Formula Sheets",
        subject: "Chemistry",
        classLevel: "HSC / Admission",
        summary: "Color-coded SN1/SN2, electrophilic aromatic substitution, and reagent conversion pathways.",
        contentPreview: "High-yield conversion chart linking alkanes, alcohols, aldehydes, ketones, carboxylic acids, and amines with reagent conditions and exceptions.",
        thumbnailUrl: "/api/assets/default-banner.svg",
        resourceUrl: "/tuitions?subject=Chemistry",
        accessLevel: "pro",
        authorId: "usr_tutor_03",
        authorName: "Mahmudul Hasan",
        authorEmail: "mahmud.tutor@mentorlagbe.com",
        approvalStatus: "approved",
        downloads: 192,
        createdAt: daysAgoIso2(6)
      },
      {
        _id: "res_06",
        title: "Human Physiology & Genetics High-Yield Question Bank",
        category: "Past Papers",
        subject: "Biology",
        classLevel: "HSC / Medical Prep",
        summary: "Chapter-by-chapter MCQ bank covering cardiac cycle, nephron filtration, DNA replication, and Mendelian ratios.",
        contentPreview: "Includes 80 timed MCQs with physiological pathway explanations designed for HSC Board and Medical Admission prep.",
        thumbnailUrl: "/api/assets/default-banner.svg",
        resourceUrl: "/tuitions?subject=Biology",
        accessLevel: "free",
        authorId: "usr_tutor_01",
        authorName: "Dr. Tanvir Ahmed",
        authorEmail: "tutor@mentorlagbe.com",
        approvalStatus: "approved",
        downloads: 241,
        createdAt: daysAgoIso2(4)
      }
    ];
    for (const r of resources) {
      await db.resources.insertOne(r);
    }
  }
  if (reqCount === 0) {
    const requests = [
      {
        _id: "treq_01",
        studentId: "usr_student_01",
        studentName: "Rafiul Islam",
        studentEmail: "student@mentorlagbe.com",
        title: "Need BUET-track Higher Math & Physics 1-on-1 Mentor",
        subject: "Mathematics",
        classLevel: "HSC / Class 11-12",
        mode: "Online",
        location: "Remote / Dhaka",
        budgetMonthly: 7500,
        daysPerWeek: 4,
        scheduleNote: "Sun, Tue, Thu, Fri evenings (8:00 PM - 9:30 PM)",
        description: "Looking for structured problem-solving mentorship covering Conics, Calculus, and Mechanics with weekly timed mock reviews.",
        status: "open",
        responses: [
          {
            _id: "tresp_01",
            tutorId: "usr_tutor_01",
            tutorName: "Dr. Tanvir Ahmed",
            tutorImage: "/api/assets/default-avatar.svg",
            tutorPlan: "pro",
            proposedFee: 7e3,
            pitch: "I run a structured BUET admission & HSC Physics/Math track and have 8:00 PM slots open on Sun/Tue/Thu.",
            createdAt: daysAgoIso2(2)
          }
        ],
        createdAt: daysAgoIso2(5)
      },
      {
        _id: "treq_02",
        studentId: "usr_student_02",
        studentName: "Sadia Afrin",
        studentEmail: "sadia.student@mentorlagbe.com",
        title: "IELTS Speaking & Academic Writing Intensive Tutor Needed",
        subject: "IELTS",
        classLevel: "IELTS / Admission",
        mode: "Online",
        location: "Remote",
        budgetMonthly: 6500,
        daysPerWeek: 3,
        scheduleNote: "Flexible afternoons or Sat/Mon/Wed evenings",
        description: "Targeting Band 7.5+ overall within 8 weeks. Need graded Task 1/Task 2 feedback and 1-on-1 speaking mock interviews.",
        status: "open",
        responses: [],
        createdAt: daysAgoIso2(3)
      },
      {
        _id: "treq_03",
        studentId: "usr_student_01",
        studentName: "Rafiul Islam",
        studentEmail: "student@mentorlagbe.com",
        title: "Home Tutor for HSC Chemistry (Organic & Quantitative)",
        subject: "Chemistry",
        classLevel: "HSC / Class 11-12",
        mode: "Offline",
        location: "Dhanmondi, Dhaka",
        budgetMonthly: 8e3,
        daysPerWeek: 3,
        scheduleNote: "Sat, Mon, Wed after 5:00 PM",
        description: "Need focused conceptual clarity in Organic reactions and volumetric titration numericals ahead of test exams.",
        status: "open",
        responses: [],
        createdAt: daysAgoIso2(2)
      }
    ];
    for (const tr of requests) {
      await db.tutor_requests.insertOne(tr);
    }
  }
  if (msgCount === 0) {
    const messages = [
      {
        _id: "msg_01",
        senderId: "usr_student_01",
        senderName: "Rafiul Islam",
        senderRole: "student",
        senderImage: "/api/assets/default-avatar.svg",
        recipientId: "usr_tutor_01",
        recipientName: "Dr. Tanvir Ahmed",
        recipientRole: "tutor",
        recipientImage: "/api/assets/default-avatar.svg",
        body: "Assalamu Alaikum Sir, does your HSC Physics & Higher Math cohort include recorded problem-solving walkthroughs if I miss a live session?",
        read: true,
        createdAt: daysAgoIso2(3)
      },
      {
        _id: "msg_02",
        senderId: "usr_tutor_01",
        senderName: "Dr. Tanvir Ahmed",
        senderRole: "tutor",
        senderImage: "/api/assets/default-avatar.svg",
        recipientId: "usr_student_01",
        recipientName: "Rafiul Islam",
        recipientRole: "student",
        recipientImage: "/api/assets/default-avatar.svg",
        body: "Yes, every live session comes with annotated PDF slides and worked problem sheets shared right after class.",
        read: false,
        createdAt: daysAgoIso2(2)
      }
    ];
    for (const m of messages) {
      await db.messages.insertOne(m);
    }
  }
  if (ntfCount === 0) {
    const notifications = [
      {
        _id: "ntf_01",
        userEmail: "student@mentorlagbe.com",
        title: "New reply from Dr. Tanvir Ahmed",
        message: "Dr. Tanvir Ahmed replied to your message about HSC Physics & Higher Math.",
        type: "message",
        link: "/dashboard/messages",
        read: false,
        createdAt: daysAgoIso2(2)
      },
      {
        _id: "ntf_02",
        userEmail: "tutor@mentorlagbe.com",
        title: "New student application received",
        message: "Rafiul Islam applied to your HSC Physics Mechanics & Calculus cohort.",
        type: "application",
        link: "/dashboard/tutor/applicants",
        read: false,
        createdAt: daysAgoIso2(1)
      }
    ];
    for (const n of notifications) {
      await db.notifications.insertOne(n);
    }
  }
  const seedTutorDailyProgress = [
    {
      _id: "dqp_seed_tutor_01",
      userId: "usr_tutor_01",
      userEmail: "tutor@mentorlagbe.com",
      track: "tutor",
      completedLevel: 50,
      lastCompletedDate: daysAgoIso2(1).slice(0, 10),
      streak: 14,
      totalXp: 3250,
      unlockedBadgeLevels: [1, 3, 5, 8, 10, 15, 25, 50],
      updatedAt: daysAgoIso2(1)
    },
    {
      _id: "dqp_seed_tutor_02",
      userId: "usr_tutor_02",
      userEmail: "nusrat.tutor@mentorlagbe.com",
      track: "tutor",
      completedLevel: 15,
      lastCompletedDate: daysAgoIso2(2).slice(0, 10),
      streak: 6,
      totalXp: 940,
      unlockedBadgeLevels: [1, 3, 5, 10, 15],
      updatedAt: daysAgoIso2(2)
    },
    {
      _id: "dqp_seed_tutor_03",
      userId: "usr_tutor_03",
      userEmail: "mahmud.tutor@mentorlagbe.com",
      track: "tutor",
      completedLevel: 30,
      lastCompletedDate: daysAgoIso2(1).slice(0, 10),
      streak: 9,
      totalXp: 1920,
      unlockedBadgeLevels: [1, 3, 5, 8, 10, 15, 20, 25, 30],
      updatedAt: daysAgoIso2(1)
    }
  ];
  for (const progress of seedTutorDailyProgress) {
    const [existingUser, existingProgress] = await Promise.all([
      db.users.findOne((u) => u._id === progress.userId),
      db.quiz_daily_progress.findOne((p) => p.userId === progress.userId)
    ]);
    if (existingUser && !existingProgress) {
      await db.quiz_daily_progress.insertOne(progress);
    }
  }
  if (customQuizCount === 0) {
    const seededQuizzes = [
      {
        _id: "cqz_seed_01",
        title: "HSC Calculus & Vectors Coin Sprint",
        subject: "Mathematics",
        level: "HSC / Admission",
        durationMinutes: 10,
        description: "Solve 2 MCQs and 1 short written CQ problem accurately to win 10 coins from Dr. Tanvir Ahmed\u2019s 500-coin prize pool.",
        authorId: "usr_tutor_01",
        authorName: "Dr. Tanvir Ahmed",
        authorEmail: "tutor@mentorlagbe.com",
        authorImage: "/api/assets/default-avatar.svg",
        visibility: "public",
        shareCode: "MLQ-MATH500",
        audience: "all",
        approvalStatus: "approved",
        rewardPerWinner: 10,
        maxWinners: 50,
        winnersCount: 0,
        winnerUserIds: [],
        rewardPoolTotal: 500,
        rewardPoolRemaining: 500,
        questions: [
          {
            id: "q1",
            type: "mcq",
            prompt: "What is the derivative of sin(3x) with respect to x?",
            options: ["3cos(3x)", "cos(3x)", "-3cos(3x)", "(1/3)cos(3x)"],
            correctIndex: 0,
            explanation: "By the chain rule, d/dx[sin(3x)] = cos(3x) * 3 = 3cos(3x)."
          },
          {
            id: "q2",
            type: "mcq",
            prompt: "Two vectors A and B are perpendicular when their dot product A\xB7B equals:",
            options: ["1", "0", "|A||B|", "-1"],
            correctIndex: 1,
            explanation: "Since A\xB7B = |A||B|cos(90\xB0) = 0, perpendicular vectors have zero dot product."
          },
          {
            id: "q3",
            type: "cq",
            prompt: "CQ: Find the value of the definite integral \u222B\u2080\xB2 3x\xB2 dx (write the final number or brief step).",
            sampleAnswer: "8",
            keywords: ["8"],
            explanation: "The antiderivative of 3x\xB2 is x\xB3. Evaluating from 0 to 2 gives 2\xB3 - 0\xB3 = 8."
          }
        ],
        createdAt: daysAgoIso2(3)
      },
      {
        _id: "cqz_seed_02",
        title: "IELTS Band 8 Grammar & Sentence Precision Challenge",
        subject: "IELTS",
        level: "Band 7.0 - 8.5",
        durationMinutes: 8,
        description: "Student-only mastery check combining Academic IELTS MCQs and a concise written synthesis question.",
        authorId: "usr_tutor_02",
        authorName: "Nusrat Rahman",
        authorEmail: "nusrat.tutor@mentorlagbe.com",
        authorImage: "/api/assets/default-avatar.svg",
        visibility: "public",
        shareCode: "MLQ-IELTS300",
        audience: "students",
        approvalStatus: "approved",
        rewardPerWinner: 15,
        maxWinners: 20,
        winnersCount: 0,
        winnerUserIds: [],
        rewardPoolTotal: 300,
        rewardPoolRemaining: 300,
        questions: [
          {
            id: "q1",
            type: "mcq",
            prompt: "Which linker expresses concession cleanly in an IELTS Task 2 essay?",
            options: ["Nevertheless", "Therefore", "Namely", "Moreover"],
            correctIndex: 0,
            explanation: '"Nevertheless" introduces a contrasting concession to the previous point.'
          },
          {
            id: "q2",
            type: "mcq",
            prompt: "Choose the grammatically accurate Academic Task 1 phrase:",
            options: [
              "Sales witnessed a sharp rose in 2024.",
              "Sales experienced a sharp rise in 2024.",
              "Sales were rise sharply in 2024.",
              "Sales peaked down in 2024."
            ],
            correctIndex: 1,
            explanation: '"Experienced a sharp rise" uses the noun form "rise" accurately.'
          },
          {
            id: "q3",
            type: "cq",
            prompt: "CQ: Name the IELTS Writing criterion that evaluates linking words, paragraphing, and logical flow.",
            sampleAnswer: "Coherence and Cohesion",
            keywords: ["coherence", "cohesion"],
            explanation: "IELTS Writing assesses Task Achievement/Response, Coherence and Cohesion, Lexical Resource, and Grammatical Range."
          }
        ],
        createdAt: daysAgoIso2(2)
      },
      {
        _id: "cqz_seed_03",
        title: "Tutor Mastery: Python Complexity & SQL Design Check",
        subject: "Programming",
        level: "Tutor Benchmark",
        durationMinutes: 8,
        description: "Exclusive peer challenge for verified tutors covering algorithmic complexity and relational query design.",
        authorId: "usr_tutor_03",
        authorName: "Mahmudul Hasan",
        authorEmail: "mahmud.tutor@mentorlagbe.com",
        authorImage: "/api/assets/default-avatar.svg",
        visibility: "public",
        shareCode: "MLQ-TUTOR300",
        audience: "tutors",
        approvalStatus: "approved",
        rewardPerWinner: 20,
        maxWinners: 15,
        winnersCount: 0,
        winnerUserIds: [],
        rewardPoolTotal: 300,
        rewardPoolRemaining: 300,
        questions: [
          {
            id: "q1",
            type: "mcq",
            prompt: "What is the worst-case time complexity of binary search on a sorted array of n items?",
            options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
            correctIndex: 1,
            explanation: "Binary search halves the search space at each step, running in O(log n) worst-case time."
          },
          {
            id: "q2",
            type: "cq",
            prompt: "CQ: Which SQL keyword eliminates duplicate rows from a SELECT result set?",
            sampleAnswer: "DISTINCT",
            keywords: ["distinct"],
            explanation: "SELECT DISTINCT filters duplicate result rows."
          }
        ],
        createdAt: daysAgoIso2(1)
      }
    ];
    for (const q of seededQuizzes) {
      await db.custom_quizzes.insertOne(q);
    }
  }
}

// src/middleware/auth.ts
import jwt2 from "jsonwebtoken";
import crypto3 from "crypto";
var AUTH_COOKIE_NAME = "ml_token";
var COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var ephemeralDevJwtSecret = null;
function getJwtSecret() {
  const configured = process.env.JWT_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (isProduction()) {
    if (!isStrongSecret(configured, 32)) {
      throw new Error("JWT_SECRET must be configured with a strong 32+ char secret in production.");
    }
    return configured;
  }
  if (configured) return configured;
  if (!ephemeralDevJwtSecret) {
    ephemeralDevJwtSecret = crypto3.randomBytes(32).toString("hex");
  }
  return ephemeralDevJwtSecret;
}
function hashToken(token) {
  return crypto3.createHash("sha256").update(token).digest("hex");
}
function signAuthToken(userId, email) {
  return jwt2.sign({ userId, email }, getJwtSecret(), { expiresIn: "7d" });
}
function setAuthCookie(req, res, token) {
  const isHttps = Boolean(
    req.secure || req.headers["x-forwarded-proto"] === "https" || process.env.APP_URL?.startsWith("https://")
  );
  const options = {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    ...isHttps ? { partitioned: true } : {},
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/"
  };
  res.cookie(AUTH_COOKIE_NAME, token, options);
}
function clearAuthCookie(req, res) {
  const isHttps = Boolean(
    req.secure || req.headers["x-forwarded-proto"] === "https" || process.env.APP_URL?.startsWith("https://")
  );
  const options = {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    ...isHttps ? { partitioned: true } : {},
    path: "/"
  };
  res.clearCookie(AUTH_COOKIE_NAME, options);
}
function sanitizeUser(user) {
  const { passwordHash: _omit, ...safe } = user;
  return {
    ...safe,
    facebookUrl: safe.facebookUrl || "",
    youtubeUrl: safe.youtubeUrl || "",
    coins: typeof safe.coins === "number" ? safe.coins : 0
  };
}
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && token !== "null" && token !== "undefined") return token;
  }
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}
function csrfOriginCheck(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  if (req.path === "/api/payments/webhook") {
    next();
    return;
  }
  const hasCookie = Boolean(req.cookies?.[AUTH_COOKIE_NAME]);
  const hasBearer = Boolean(req.headers.authorization?.startsWith("Bearer "));
  if (hasCookie && !hasBearer) {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : void 0;
    const referer = typeof req.headers.referer === "string" ? req.headers.referer : void 0;
    const requestHost = typeof req.headers.host === "string" ? req.headers.host : void 0;
    let checkOrigin = origin;
    if (!checkOrigin && referer) {
      try {
        checkOrigin = new URL(referer).origin;
      } catch {
        checkOrigin = void 0;
      }
    }
    if (checkOrigin && !isOriginAllowed(checkOrigin, requestHost)) {
      res.status(403).json({ error: "Cross-origin state mutation denied." });
      return;
    }
  }
  next();
}
async function verifyToken(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required. Please sign in." });
      return;
    }
    let decoded;
    try {
      decoded = jwt2.verify(token, getJwtSecret());
    } catch {
      res.status(401).json({ error: "Session expired or invalid token. Please sign in again." });
      return;
    }
    const db = await getDb();
    const tokenHash = hashToken(token);
    const session = await db.auth_sessions.findByField("tokenHash", tokenHash);
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      if (session) {
        await db.auth_sessions.deleteOne((s) => s._id === session._id).catch(() => false);
      }
      res.status(401).json({ error: "Session expired. Please sign in again." });
      return;
    }
    const dbUser = await db.users.findById(decoded.userId);
    if (!dbUser) {
      res.status(401).json({ error: "User account not found." });
      return;
    }
    req.user = sanitizeUser(dbUser);
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}
async function optionalAuth(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }
    try {
      const decoded = jwt2.verify(token, getJwtSecret());
      const db = await getDb();
      const session = await db.auth_sessions.findByField("tokenHash", hashToken(token));
      if (session && new Date(session.expiresAt).getTime() >= Date.now()) {
        const dbUser = await db.users.findById(decoded.userId);
        if (dbUser) {
          req.user = sanitizeUser(dbUser);
          req.token = token;
        }
      }
    } catch {
    }
    next();
  } catch (err) {
    next(err);
  }
}
function verifyStudent(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (req.user.role !== "student") {
    res.status(403).json({ error: "Access restricted to Student accounts." });
    return;
  }
  next();
}
function verifyTutor(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (req.user.role !== "tutor") {
    res.status(403).json({ error: "Access restricted to Tutor accounts." });
    return;
  }
  next();
}
function verifyAdmin(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Access restricted to Admin accounts." });
    return;
  }
  next();
}
function errorHandler(err, _req, res, _next) {
  console.error("[API Error]", err);
  const message = process.env.NODE_ENV === "production" ? "An unexpected error occurred." : err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
}

// src/middleware/rateLimit.ts
var buckets = /* @__PURE__ */ new Map();
var lastCleanupAt = Date.now();
function createRateLimiter(options) {
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanupAt > 12e4) {
      for (const [k, b] of buckets.entries()) {
        if (b.resetAt <= now) buckets.delete(k);
      }
      lastCleanupAt = now;
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const userId = req.user?._id;
    const key = `${options.keyPrefix}:${userId || ip}`;
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    if (existing.count >= options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1e3));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: options.message || "Too many requests. Please wait a moment before trying again."
      });
      return;
    }
    existing.count += 1;
    buckets.set(key, existing);
    next();
  };
}
var authRateLimiter = createRateLimiter({
  windowMs: 6e4,
  max: 40,
  keyPrefix: "auth",
  message: "Too many authentication attempts. Please try again in a minute."
});
var apiWriteRateLimiter = createRateLimiter({
  windowMs: 6e4,
  max: 120,
  keyPrefix: "write"
});
var uploadRateLimiter = createRateLimiter({
  windowMs: 6e4,
  max: 25,
  keyPrefix: "upload",
  message: "Too many file uploads. Please wait a minute before uploading again."
});
var paymentRateLimiter = createRateLimiter({
  windowMs: 6e4,
  max: 20,
  keyPrefix: "payment",
  message: "Too many checkout requests. Please wait a minute before trying again."
});

// src/routes/auth.ts
import { Router } from "express";
import crypto4 from "crypto";
import bcrypt2 from "bcryptjs";
import { z } from "zod";
var router = Router();
var DUMMY_BCRYPT_HASH = bcrypt2.hashSync(crypto4.randomBytes(16).toString("hex"), 10);
var pendingOAuthStates = /* @__PURE__ */ new Map();
var pendingOAuthExchanges = /* @__PURE__ */ new Map();
var pendingGoogleRegistrations = /* @__PURE__ */ new Map();
function cleanupExpiredOAuthEntries() {
  const now = Date.now();
  for (const [k, v] of pendingOAuthStates.entries()) {
    if (v.expiresAt < now) pendingOAuthStates.delete(k);
  }
  for (const [k, v] of pendingOAuthExchanges.entries()) {
    if (v.expiresAt < now) pendingOAuthExchanges.delete(k);
  }
  for (const [k, v] of pendingGoogleRegistrations.entries()) {
    if (v.expiresAt < now) pendingGoogleRegistrations.delete(k);
  }
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function isSafeHttpsUrl(raw) {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function resolveAppBaseOrigin(req) {
  const queryOrigin = typeof req.query.origin === "string" ? req.query.origin.trim() : void 0;
  const headerOrigin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : void 0;
  const candidateOrigin = queryOrigin || headerOrigin;
  const requestHost = typeof req.headers.host === "string" ? req.headers.host : void 0;
  if (candidateOrigin && isOriginAllowed(candidateOrigin, requestHost)) {
    try {
      return new URL(candidateOrigin).origin.replace(/\/+$/, "");
    } catch {
    }
  }
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && !appUrl.includes("localhost")) {
    try {
      return new URL(appUrl).origin.replace(/\/+$/, "");
    } catch {
    }
  }
  return getPrimaryAppOrigin(headerOrigin, requestHost).replace(/\/+$/, "");
}
var signUpSchema = z.object({
  name: z.string().trim().min(2, "Full name must be at least 2 characters").max(80),
  email: z.string().trim().email("Please provide a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  role: z.enum(["student", "tutor"])
});
var signInSchema = z.object({
  email: z.string().trim().email("Please provide a valid email address"),
  password: z.string().min(1, "Password is required")
});
async function createSessionAndToken(userId, email) {
  const db = await getDb();
  const token = signAuthToken(userId, email);
  const expiresAtDate = new Date(Date.now() + COOKIE_MAX_AGE_MS);
  await db.auth_sessions.insertOne({
    _id: `ses_${generateId()}`,
    userId,
    userEmail: email,
    tokenHash: hashToken(token),
    expiresAt: expiresAtDate.toISOString(),
    expiresAtDate,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return token;
}
router.post("/sign-up", authRateLimiter, async (req, res, next) => {
  try {
    const parsed = signUpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid registration data." });
      return;
    }
    const { name, email, password, role } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const db = await getDb();
    const existing = await db.users.findByField("email", normalizedEmail);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const passwordHash = await bcrypt2.hash(password, 10);
    const defaultAvatar = role === "tutor" ? "/api/assets/default-avatar.svg" : "/api/assets/default-avatar.svg";
    let created;
    try {
      created = await db.users.insertOne({
        _id: `usr_${generateId()}`,
        name,
        email: normalizedEmail,
        image: defaultAvatar,
        role,
        phone: "",
        bio: "",
        plan: "free",
        savedTuitionIds: [],
        passwordHash,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        res.status(409).json({ error: "An account with this email already exists." });
        return;
      }
      throw err;
    }
    const token = await createSessionAndToken(created._id, created.email);
    setAuthCookie(req, res, token);
    res.status(201).json({
      user: sanitizeUser(created),
      token
    });
  } catch (err) {
    next(err);
  }
});
router.post("/sign-in", authRateLimiter, async (req, res, next) => {
  try {
    const parsed = signInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid credentials." });
      return;
    }
    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const db = await getDb();
    const user = await db.users.findByField("email", normalizedEmail);
    const valid = await bcrypt2.compare(password, user?.passwordHash || DUMMY_BCRYPT_HASH);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    const token = await createSessionAndToken(user._id, user.email);
    setAuthCookie(req, res, token);
    res.json({
      user: sanitizeUser(user),
      token
    });
  } catch (err) {
    next(err);
  }
});
router.get("/google/status", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const origin = resolveAppBaseOrigin(req);
  res.json({
    configured: Boolean(clientId && clientSecret),
    callbackUrl: `${origin}/api/auth/google/callback`
  });
});
router.get("/google/url", authRateLimiter, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const origin = resolveAppBaseOrigin(req);
  const redirectUri = `${origin}/api/auth/google/callback`;
  if (!clientId || !clientSecret) {
    res.status(503).json({
      error: `Google Login requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to be configured in environment secrets with callback URL: ${redirectUri}`,
      code: "GOOGLE_OAUTH_NOT_CONFIGURED",
      callbackUrl: redirectUri
    });
    return;
  }
  cleanupExpiredOAuthEntries();
  const state = crypto4.randomBytes(24).toString("hex");
  pendingOAuthStates.set(state, {
    redirectUri,
    origin,
    expiresAt: Date.now() + 10 * 60 * 1e3
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });
  res.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  });
});
function renderOAuthPopupHtml(payload, targetOrigin, message) {
  const serializedPayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const serializedOrigin = JSON.stringify(targetOrigin).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Google Sign-In \u2014 MentorLagbe</title></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F5F8FC;color:#0F2438;">
    <div style="text-align:center;padding:24px;max-width:360px;">
      <p style="font-size:15px;font-weight:600;">${escapeHtml(message)}</p>
      <p style="font-size:12px;color:#52657A;">This window will close automatically.</p>
    </div>
    <script>
      (function() {
        var payload = ${serializedPayload};
        var targetOrigin = ${serializedOrigin};
        if (window.opener) {
          try {
            window.opener.postMessage(payload, targetOrigin);
          } catch (e) {
            // Never fall back to a wildcard origin: the payload carries a one-time sign-in code.
          }
          window.close();
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`;
}
router.get(["/google/callback", "/google/callback/"], async (req, res) => {
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  cleanupExpiredOAuthEntries();
  const stateEntry = state ? pendingOAuthStates.get(state) : void 0;
  if (state) pendingOAuthStates.delete(state);
  const fallbackOrigin = stateEntry?.origin || resolveAppBaseOrigin(req);
  if (oauthError) {
    res.status(400).send(
      renderOAuthPopupHtml(
        { type: "OAUTH_AUTH_ERROR", error: "Google sign-in was cancelled or denied." },
        fallbackOrigin,
        "Google sign-in was cancelled."
      )
    );
    return;
  }
  if (!code || !stateEntry || stateEntry.expiresAt < Date.now()) {
    res.status(400).send(
      renderOAuthPopupHtml(
        { type: "OAUTH_AUTH_ERROR", error: "Invalid or expired OAuth state. Please try again." },
        fallbackOrigin,
        "Session expired. Please retry Google Sign-In."
      )
    );
    return;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    res.status(503).send(
      renderOAuthPopupHtml(
        { type: "OAUTH_AUTH_ERROR", error: "Google OAuth credentials are not configured." },
        fallbackOrigin,
        "Google OAuth is not configured."
      )
    );
    return;
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: stateEntry.redirectUri,
        grant_type: "authorization_code"
      }).toString()
    });
    if (!tokenRes.ok) {
      res.status(401).send(
        renderOAuthPopupHtml(
          { type: "OAUTH_AUTH_ERROR", error: "Failed to verify Google authorization code." },
          stateEntry.origin,
          "Could not complete Google Sign-In."
        )
      );
      return;
    }
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      throw new Error("Missing access token from Google.");
    }
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    if (!userInfoRes.ok) {
      throw new Error("Failed to fetch Google user profile.");
    }
    const profile = await userInfoRes.json();
    if (!profile.email || profile.email_verified !== true) {
      res.status(403).send(
        renderOAuthPopupHtml(
          { type: "OAUTH_AUTH_ERROR", error: "Your Google account must have a verified email address." },
          stateEntry.origin,
          "Verified Google email is required."
        )
      );
      return;
    }
    const normalizedEmail = profile.email.toLowerCase();
    const db = await getDb();
    let user = await db.users.findByField("email", normalizedEmail);
    const verifiedPicture = isSafeHttpsUrl(profile.picture) ? profile.picture : void 0;
    const exchangeCode = crypto4.randomBytes(24).toString("hex");
    if (user) {
      if (verifiedPicture && (user.image.startsWith("/src/assets/") || user.image.startsWith("/api/assets/"))) {
        const updated = await db.users.updateOne(
          (u) => u._id === user._id,
          (u) => ({ ...u, image: verifiedPicture })
        );
        if (updated) user = updated;
      }
      pendingOAuthExchanges.set(exchangeCode, {
        kind: "existing",
        userId: user._id,
        email: user.email,
        expiresAt: Date.now() + 60 * 1e3
      });
      res.send(
        renderOAuthPopupHtml(
          { type: "OAUTH_AUTH_SUCCESS", code: exchangeCode },
          stateEntry.origin,
          `Signed in as ${user.name}. Redirecting...`
        )
      );
      return;
    }
    const displayName = (profile.name || normalizedEmail.split("@")[0]).trim().slice(0, 80);
    pendingOAuthExchanges.set(exchangeCode, {
      kind: "new_profile",
      email: normalizedEmail,
      name: displayName,
      picture: verifiedPicture,
      expiresAt: Date.now() + 2 * 60 * 1e3
    });
    res.send(
      renderOAuthPopupHtml(
        { type: "OAUTH_AUTH_SUCCESS", code: exchangeCode },
        stateEntry.origin,
        `Google verified for ${displayName}. Select your account type...`
      )
    );
  } catch (err) {
    console.error("[Google OAuth Error]", err);
    res.status(500).send(
      renderOAuthPopupHtml(
        { type: "OAUTH_AUTH_ERROR", error: "Google authentication failed. Please try again." },
        stateEntry.origin,
        "Authentication failed."
      )
    );
  }
});
router.post("/google/exchange", authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({ code: z.string().min(16).max(128) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid OAuth exchange code." });
      return;
    }
    cleanupExpiredOAuthEntries();
    const entry = pendingOAuthExchanges.get(parsed.data.code);
    pendingOAuthExchanges.delete(parsed.data.code);
    if (!entry || entry.expiresAt < Date.now()) {
      res.status(401).json({ error: "Google sign-in session expired. Please try again." });
      return;
    }
    if (entry.kind === "new_profile") {
      const setupToken = crypto4.randomBytes(24).toString("hex");
      pendingGoogleRegistrations.set(setupToken, {
        email: entry.email,
        name: entry.name,
        picture: entry.picture,
        expiresAt: Date.now() + 10 * 60 * 1e3
      });
      res.json({
        needsRoleSelection: true,
        setupToken,
        profile: {
          name: entry.name,
          email: entry.email,
          image: entry.picture
        }
      });
      return;
    }
    const db = await getDb();
    const user = await db.users.findById(entry.userId);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    const token = await createSessionAndToken(user._id, user.email);
    setAuthCookie(req, res, token);
    res.json({
      needsRoleSelection: false,
      user: sanitizeUser(user),
      token
    });
  } catch (err) {
    next(err);
  }
});
router.post("/google/complete", authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      setupToken: z.string().min(16).max(128),
      role: z.enum(["student", "tutor"])
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please choose whether this is a Student or Tutor account." });
      return;
    }
    cleanupExpiredOAuthEntries();
    const pending = pendingGoogleRegistrations.get(parsed.data.setupToken);
    pendingGoogleRegistrations.delete(parsed.data.setupToken);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(401).json({ error: "Google account setup expired. Please sign in with Google again." });
      return;
    }
    const db = await getDb();
    const existing = await db.users.findByField("email", pending.email.toLowerCase());
    if (existing) {
      const token2 = await createSessionAndToken(existing._id, existing.email);
      setAuthCookie(req, res, token2);
      res.json({ user: sanitizeUser(existing), token: token2 });
      return;
    }
    const defaultAvatar = parsed.data.role === "tutor" ? "/api/assets/default-avatar.svg" : "/api/assets/default-avatar.svg";
    const created = await db.users.insertOne({
      _id: `usr_${generateId()}`,
      name: pending.name,
      email: pending.email.toLowerCase(),
      image: pending.picture || defaultAvatar,
      role: parsed.data.role,
      phone: "",
      bio: "",
      plan: "free",
      savedTuitionIds: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const token = await createSessionAndToken(created._id, created.email);
    setAuthCookie(req, res, token);
    res.status(201).json({
      user: sanitizeUser(created),
      token
    });
  } catch (err) {
    next(err);
  }
});
router.post("/sign-out", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = (authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null) || (typeof req.cookies?.ml_token === "string" ? req.cookies.ml_token : null);
    if (token) {
      const db = await getDb();
      await db.auth_sessions.deleteOne((s) => s.tokenHash === hashToken(token));
    }
    clearAuthCookie(req, res);
    res.json({ message: "Signed out successfully." });
  } catch (err) {
    next(err);
  }
});
router.get("/session", verifyToken, (req, res) => {
  res.json({ user: req.user, token: req.token });
});
var auth_default = router;

// src/routes/tuitions.ts
import { Router as Router2 } from "express";
import { z as z2 } from "zod";
var router2 = Router2();
function isSafeAssetUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/src/assets/") || trimmed.startsWith("/api/uploads/") || trimmed.startsWith("/api/assets/")) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
var createTuitionSchema = z2.object({
  title: z2.string().trim().min(5, "Title must be at least 5 characters").max(140),
  subject: z2.string().trim().min(2, "Subject is required").max(60),
  classLevel: z2.string().trim().min(2, "Class level is required").max(60),
  mode: z2.enum(["Online", "Offline"]),
  location: z2.string().trim().min(2, "Location is required").max(100),
  monthlyFee: z2.coerce.number().min(500, "Monthly fee must be at least 500").max(1e5),
  daysPerWeek: z2.coerce.number().int().min(1).max(7),
  description: z2.string().trim().min(20, "Description must be at least 20 characters").max(2e3),
  bannerImage: z2.string().trim().min(1, "Banner image is required").refine(isSafeAssetUrl, "Banner image must be a valid image URL.")
});
var updateTuitionSchema = createTuitionSchema.partial().extend({
  isActive: z2.boolean().optional()
});
var reviewSchema = z2.object({
  rating: z2.coerce.number().int().min(1).max(5),
  comment: z2.string().trim().min(5, "Please write a brief review comment").max(600)
});
function withoutReviewerEmails(t) {
  return {
    ...t,
    reviews: (t.reviews || []).map(({ studentEmail: _email, ...review }) => review)
  };
}
var CONTENT_FIELDS = [
  "title",
  "subject",
  "classLevel",
  "mode",
  "location",
  "monthlyFee",
  "daysPerWeek",
  "description",
  "bannerImage"
];
function formatPublicTuition(t, tutor) {
  return {
    ...t,
    tutorId: tutor?._id,
    tutorImage: tutor?.image || t.tutorImage || "/api/assets/default-avatar.svg",
    tutorPlan: tutor?.plan || t.tutorPlan || "free",
    reviews: (t.reviews || []).map((r) => ({
      _id: r._id,
      studentName: r.studentName,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt
    }))
  };
}
router2.get("/stats", async (_req, res, next) => {
  try {
    const db = await getDb();
    const [totalStudents, verifiedTutors, availableTuitions, successfulConnections] = await Promise.all([
      db.users.count((u) => u.role === "student"),
      db.users.count((u) => u.role === "tutor"),
      db.tuitions.count((t) => t.approvalStatus === "approved" && t.isActive === true),
      db.applications.count((a) => a.status === "accepted")
    ]);
    res.json({
      totalStudents,
      verifiedTutors,
      availableTuitions,
      successfulConnections
    });
  } catch (err) {
    next(err);
  }
});
router2.get("/", async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
    const classLevel = typeof req.query.classLevel === "string" ? req.query.classLevel.trim() : "";
    const mode = typeof req.query.mode === "string" ? req.query.mode.trim() : "";
    const maxFee = req.query.maxFee ? Number(req.query.maxFee) : void 0;
    const sort = typeof req.query.sort === "string" ? req.query.sort.trim() : "latest";
    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(24, Math.max(1, Number.parseInt(String(req.query.limit || "9"), 10) || 9));
    const [tutors, queryResult] = await Promise.all([
      db.users.find((u) => u.role === "tutor"),
      queryApprovedTuitions(db, {
        search,
        subject,
        classLevel,
        mode,
        maxFee: Number.isFinite(maxFee) ? maxFee : void 0,
        sort,
        page,
        limit
      })
    ]);
    const tutorByEmail = new Map(tutors.map((u) => [u.email.toLowerCase(), u]));
    const items = queryResult.items.map(
      (t) => formatPublicTuition(t, tutorByEmail.get(t.tutorEmail.toLowerCase()))
    );
    res.json({
      items,
      total: queryResult.total,
      page: queryResult.page,
      limit,
      totalPages: queryResult.totalPages
    });
  } catch (err) {
    next(err);
  }
});
router2.get("/tutor/mine", verifyToken, verifyTutor, async (req, res, next) => {
  try {
    const db = await getDb();
    const myEmail = req.user.email.toLowerCase();
    const [tuitions, applications] = await Promise.all([
      db.tuitions.find((t) => t.tutorEmail.toLowerCase() === myEmail),
      db.applications.find((a) => a.tutorEmail.toLowerCase() === myEmail)
    ]);
    tuitions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const items = tuitions.map((t) => ({
      ...withoutReviewerEmails(t),
      applicantCount: applications.filter((a) => a.tuitionId === t._id).length,
      acceptedCount: applications.filter((a) => a.tuitionId === t._id && a.status === "accepted").length
    }));
    res.json({
      items,
      totalPosted: tuitions.length,
      plan: req.user.plan,
      remainingFreePosts: req.user.plan === "pro" ? null : Math.max(0, 2 - tuitions.length)
    });
  } catch (err) {
    next(err);
  }
});
router2.get("/:id", optionalAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const tuition = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!tuition) {
      res.status(404).json({ error: "Tuition listing not found." });
      return;
    }
    const isOwner = Boolean(req.user && req.user.email.toLowerCase() === tuition.tutorEmail.toLowerCase());
    const isAdmin = req.user?.role === "admin";
    if ((tuition.approvalStatus !== "approved" || !tuition.isActive) && !isOwner && !isAdmin) {
      res.status(404).json({ error: "Tuition listing is currently unavailable." });
      return;
    }
    const tutor = await db.users.findOne((u) => u.email.toLowerCase() === tuition.tutorEmail.toLowerCase());
    let hasApplied = false;
    let canReview = false;
    let hasReviewed = false;
    if (req.user?.role === "student") {
      const studentEmail = req.user.email.toLowerCase();
      const app = await db.applications.findOne(
        (a) => a.tuitionId === tuition._id && a.studentEmail.toLowerCase() === studentEmail
      );
      hasApplied = Boolean(app);
      hasReviewed = Boolean(tuition.reviews?.some((r) => r.studentEmail.toLowerCase() === studentEmail));
      canReview = Boolean(app && app.status === "accepted" && !hasReviewed);
    }
    const [relatedCandidates, allTutors] = await Promise.all([
      db.tuitions.find(
        (t) => t._id !== tuition._id && t.approvalStatus === "approved" && t.isActive && (t.subject.toLowerCase() === tuition.subject.toLowerCase() || t.classLevel.toLowerCase() === tuition.classLevel.toLowerCase())
      ),
      db.users.find((u) => u.role === "tutor")
    ]);
    const tutorMap = new Map(allTutors.map((u) => [u.email.toLowerCase(), u]));
    const relatedTuitions = relatedCandidates.slice(0, 3).map((t) => formatPublicTuition(t, tutorMap.get(t.tutorEmail.toLowerCase())));
    res.json({
      tuition: {
        ...formatPublicTuition(tuition, tutor || void 0),
        tutorBio: tutor?.bio || ""
      },
      relatedTuitions,
      viewerState: {
        hasApplied,
        canReview,
        hasReviewed,
        isSaved: Boolean(req.user?.savedTuitionIds?.includes(tuition._id))
      }
    });
  } catch (err) {
    next(err);
  }
});
router2.post("/", verifyToken, verifyTutor, async (req, res, next) => {
  try {
    const parsed = createTuitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid tuition details." });
      return;
    }
    const db = await getDb();
    const tutor = req.user;
    const myTuitions = await db.tuitions.find(
      (t) => t.tutorEmail.toLowerCase() === tutor.email.toLowerCase()
    );
    if (tutor.plan !== "pro" && myTuitions.length >= 2) {
      res.status(403).json({
        error: "Free Tutor accounts can post up to 2 tuition listings. Upgrade to Pro Tutor for unlimited posts.",
        code: "POST_LIMIT_REACHED"
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
      approvalStatus: "pending",
      isActive: true,
      reviews: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.status(201).json({ tuition: withoutReviewerEmails(created) });
  } catch (err) {
    next(err);
  }
});
router2.patch("/:id", verifyToken, verifyTutor, async (req, res, next) => {
  try {
    const parsed = updateTuitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid update payload." });
      return;
    }
    const db = await getDb();
    const existing = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Tuition listing not found." });
      return;
    }
    if (existing.tutorEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      res.status(403).json({ error: "You do not have permission to edit this tuition." });
      return;
    }
    if (parsed.data.isActive === true && existing.adminDisabled) {
      res.status(403).json({
        error: "This listing was deactivated by an administrator and cannot be re-activated by the tutor."
      });
      return;
    }
    const contentChanged = CONTENT_FIELDS.some(
      (field) => parsed.data[field] !== void 0 && parsed.data[field] !== existing[field]
    );
    const needsReview = contentChanged && existing.approvalStatus === "approved";
    const updated = await db.tuitions.updateOne(
      (t) => t._id === existing._id,
      (t) => ({
        ...t,
        ...parsed.data,
        ...needsReview ? { approvalStatus: "pending" } : {}
      })
    );
    res.json({ tuition: updated ? withoutReviewerEmails(updated) : updated, sentForReview: needsReview });
  } catch (err) {
    next(err);
  }
});
router2.delete("/:id", verifyToken, verifyTutor, async (req, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Tuition listing not found." });
      return;
    }
    if (existing.tutorEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      res.status(403).json({ error: "You do not have permission to delete this tuition." });
      return;
    }
    await db.tuitions.deleteOne((t) => t._id === existing._id);
    await db.applications.deleteMany((a) => a.tuitionId === existing._id);
    res.json({ message: "Tuition deleted successfully." });
  } catch (err) {
    next(err);
  }
});
router2.post("/:id/reviews", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid review data." });
      return;
    }
    const db = await getDb();
    const tuition = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!tuition) {
      res.status(404).json({ error: "Tuition listing not found." });
      return;
    }
    const studentEmail = req.user.email.toLowerCase();
    const acceptedApp = await db.applications.findOne(
      (a) => a.tuitionId === tuition._id && a.studentEmail.toLowerCase() === studentEmail && a.status === "accepted"
    );
    if (!acceptedApp) {
      res.status(403).json({ error: "Only students with an accepted application can review this tuition." });
      return;
    }
    if (tuition.reviews?.some((r) => r.studentEmail.toLowerCase() === studentEmail)) {
      res.status(409).json({ error: "You have already reviewed this tuition." });
      return;
    }
    const newReview = {
      _id: `rev_${generateId()}`,
      studentName: req.user.name,
      studentEmail: req.user.email,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const updated = await db.tuitions.updateOne(
      (t) => t._id === tuition._id,
      (t) => ({
        ...t,
        reviews: [newReview, ...t.reviews || []]
      })
    );
    res.status(201).json({
      review: {
        _id: newReview._id,
        studentName: newReview.studentName,
        rating: newReview.rating,
        comment: newReview.comment,
        createdAt: newReview.createdAt
      },
      reviews: (updated?.reviews || []).map((r) => ({
        _id: r._id,
        studentName: r.studentName,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    next(err);
  }
});
var tuitions_default = router2;

// src/routes/applications.ts
import { Router as Router3 } from "express";
import { z as z3 } from "zod";

// src/config/features.ts
function extraFeaturesEnabled() {
  return process.env.ENABLE_EXTRA_FEATURES?.trim().toLowerCase() === "true";
}

// src/utils/notifications.ts
async function createNotification(db, params) {
  if (!extraFeaturesEnabled()) return null;
  const safeLink = params.link.startsWith("/") ? params.link : "/";
  return db.notifications.insertOne({
    _id: `ntf_${generateId()}`,
    userEmail: params.userEmail.toLowerCase(),
    title: params.title.slice(0, 120),
    message: params.message.slice(0, 400),
    type: params.type,
    link: safeLink,
    read: false,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}

// src/routes/applications.ts
var router3 = Router3();
var createApplicationSchema = z3.object({
  tuitionId: z3.string().trim().min(1, "Tuition ID is required"),
  studentPhone: z3.string().trim().min(6, "Phone number is required").max(30),
  preferredSchedule: z3.string().trim().min(3, "Preferred schedule is required").max(120),
  studentNote: z3.string().trim().min(5, "Please include a short learning note").max(1e3)
});
var statusUpdateSchema = z3.object({
  status: z3.enum(["accepted", "rejected"])
});
router3.post("/", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const parsed = createApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid application form data." });
      return;
    }
    const { tuitionId, studentPhone, preferredSchedule, studentNote } = parsed.data;
    const db = await getDb();
    const tuition = await db.tuitions.findOne(
      (t) => t._id === tuitionId && t.approvalStatus === "approved" && t.isActive
    );
    if (!tuition) {
      res.status(404).json({ error: "This tuition listing is not available for applications." });
      return;
    }
    const student = req.user;
    const duplicate = await db.applications.findOne(
      (a) => a.tuitionId === tuition._id && a.studentEmail.toLowerCase() === student.email.toLowerCase()
    );
    if (duplicate) {
      res.status(409).json({ error: "You have already applied to this tuition." });
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
        status: "pending",
        appliedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        res.status(409).json({ error: "You have already applied to this tuition." });
        return;
      }
      throw err;
    }
    await createNotification(db, {
      userEmail: tuition.tutorEmail,
      title: "New tuition application",
      message: `${student.name} applied to "${tuition.title}".`,
      type: "application",
      link: "/dashboard/tutor/applicants"
    });
    res.status(201).json({ application });
  } catch (err) {
    next(err);
  }
});
router3.get("/student", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const db = await getDb();
    const studentEmail = req.user.email.toLowerCase();
    const items = await db.applications.find((a) => a.studentEmail.toLowerCase() === studentEmail);
    items.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
router3.delete("/:id", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const db = await getDb();
    const app = await db.applications.findOne((a) => a._id === req.params.id);
    if (!app) {
      res.status(404).json({ error: "Application not found." });
      return;
    }
    if (app.studentEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      res.status(403).json({ error: "You cannot cancel another student\u2019s application." });
      return;
    }
    if (app.status !== "pending") {
      res.status(400).json({ error: "Only pending applications can be cancelled." });
      return;
    }
    await db.applications.deleteOne((a) => a._id === app._id);
    res.json({ message: "Application cancelled." });
  } catch (err) {
    next(err);
  }
});
router3.get("/tutor", verifyToken, verifyTutor, async (req, res, next) => {
  try {
    const db = await getDb();
    const tutorEmail = req.user.email.toLowerCase();
    const [items, students] = await Promise.all([
      db.applications.find((a) => a.tutorEmail.toLowerCase() === tutorEmail),
      db.users.find((u) => u.role === "student")
    ]);
    const studentByEmail = new Map(students.map((u) => [u.email.toLowerCase(), u]));
    items.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
    const enriched = items.map((app) => {
      const student = studentByEmail.get(app.studentEmail.toLowerCase());
      return {
        ...app,
        studentPlan: student?.plan || "free",
        studentImage: student?.image || "/api/assets/default-avatar.svg",
        studentBio: student?.bio || ""
      };
    });
    res.json({ items: enriched });
  } catch (err) {
    next(err);
  }
});
router3.patch("/:id/status", verifyToken, verifyTutor, async (req, res, next) => {
  try {
    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Status must be accepted or rejected." });
      return;
    }
    const db = await getDb();
    const app = await db.applications.findOne((a) => a._id === req.params.id);
    if (!app) {
      res.status(404).json({ error: "Application not found." });
      return;
    }
    if (app.tutorEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      res.status(403).json({ error: "Only the owner tutor can manage this application." });
      return;
    }
    const updated = await db.applications.updateOne(
      (a) => a._id === app._id,
      (a) => ({
        ...a,
        status: parsed.data.status
      })
    );
    await createNotification(db, {
      userEmail: app.studentEmail,
      title: `Application ${parsed.data.status}`,
      message: `${req.user.name} ${parsed.data.status} your application for "${app.tuitionTitle}".`,
      type: "application",
      link: "/dashboard/student/my-applications"
    });
    res.json({ application: updated });
  } catch (err) {
    next(err);
  }
});
var applications_default = router3;

// src/routes/users.ts
import { Router as Router4 } from "express";
import { z as z4 } from "zod";

// src/utils/dailyLevels.ts
var TOTAL_DAILY_LEVELS = 1e3;
var DAILY_PASSING_SCORE = 3;
var BADGE_MILESTONE_LEVELS = [
  1,
  3,
  5,
  8,
  10,
  13,
  15,
  18,
  20,
  25,
  30,
  35,
  40,
  45,
  50,
  60,
  70,
  80,
  85,
  95,
  100,
  110,
  120,
  130,
  140,
  150,
  160,
  170,
  180,
  190,
  200,
  210,
  220,
  240,
  250,
  265,
  280,
  295,
  300,
  320,
  350,
  380,
  400,
  430,
  440,
  450,
  470,
  480,
  500,
  520,
  525,
  540,
  550,
  560,
  570,
  580,
  590,
  600,
  610,
  620,
  630,
  670,
  680,
  690,
  700,
  705,
  710,
  715,
  720,
  725,
  730,
  740,
  750,
  760,
  780,
  800,
  810,
  820,
  830,
  840,
  850,
  860,
  870,
  880,
  890,
  900,
  905,
  907,
  910,
  920,
  930,
  940,
  950,
  990,
  1e3
];
var BADGE_MILESTONE_SET = new Set(BADGE_MILESTONE_LEVELS);
function resolveDailyTrack(roleOrTrack) {
  return roleOrTrack === "tutor" ? "tutor" : "student";
}
var STUDENT_SPECIAL_BADGE_TITLES = {
  1: "Freshman Spark",
  3: "Curiosity Seeker",
  5: "Five-Day Learner",
  8: "Study Sprinter",
  10: "Honor Roll Novice",
  13: "Concept Explorer",
  15: "Fortnight Scholar",
  18: "Quiz Challenger",
  20: "Consistent Student",
  25: "Quarter-Century Cadet",
  30: "Monthly Achiever",
  50: "Half-Century Prodigy",
  100: "Centurion Scholar",
  150: "Analytical Ace",
  200: "Dean's List Star",
  250: "Quarter-Millennium Scholar",
  300: "Tri-Century Trailblazer",
  400: "Board Exam Strategist",
  500: "Half-Summit Champion",
  600: "Merit Honor Luminary",
  700: "Olympiad Contender",
  750: "Three-Quarter Titan",
  800: "Academic Virtuoso",
  900: "Valedictorian Vanguard",
  907: "Hidden Summit Seeker",
  950: "Admission Finalist",
  990: "Threshold Legend",
  1e3: "Student Grandmaster 1000"
};
var TUTOR_SPECIAL_BADGE_TITLES = {
  1: "First Class Mentor",
  3: "Classroom Catalyst",
  5: "Five-Day Educator",
  8: "Syllabus Architect",
  10: "Decade Pedagogue",
  13: "Clarity Artisan",
  15: "Fortnight Instructor",
  18: "Concept Strategist",
  20: "Dedicated Coach",
  25: "Quarter-Century Guide",
  30: "Mastery Facilitator",
  50: "Half-Century Mentor",
  100: "Centurion Educator",
  150: "Socratic Maestro",
  200: "Bicentennial Professor",
  250: "Quarter-Millennium Dean",
  300: "Tri-Century Mentor",
  400: "Curriculum Tactician",
  500: "Half-Summit Fellow",
  600: "Faculty Luminary",
  700: "Seven-Hundred Sage",
  750: "Principal Scholar",
  800: "Octa-Century Maestro",
  900: "Provost Vanguard",
  907: "Mentorship Summit Keeper",
  950: "Grand Educator",
  990: "Chancellor Legend",
  1e3: "Master Tutor 1000"
};
var STUDENT_RANK_TITLES = [
  "Learner",
  "Explorer",
  "Scholar",
  "Contender",
  "Merit Track",
  "Honors Student",
  "Olympiad",
  "Senior Fellow",
  "Valedictorian",
  "Grandmaster"
];
var TUTOR_RANK_TITLES = [
  "Instructor",
  "Coach",
  "Educator",
  "Mentor",
  "Pedagogue",
  "Senior Lecturer",
  "Faculty Fellow",
  "Master Tutor",
  "Dean Track",
  "Grand Provost"
];
function getBadgeTier(level) {
  if (level <= 45) return "Bronze";
  if (level <= 150) return "Silver";
  if (level <= 350) return "Gold";
  if (level <= 550) return "Platinum";
  if (level <= 750) return "Emerald";
  if (level <= 920) return "Diamond";
  return "Grandmaster";
}
function getBadgeForLevel(level, track = "student") {
  if (!BADGE_MILESTONE_SET.has(level)) return null;
  const tier = getBadgeTier(level);
  const rankIdx = Math.min(9, Math.floor((level - 1) / 100));
  const specialMap = track === "tutor" ? TUTOR_SPECIAL_BADGE_TITLES : STUDENT_SPECIAL_BADGE_TITLES;
  const rankTitles = track === "tutor" ? TUTOR_RANK_TITLES : STUDENT_RANK_TITLES;
  const customName = specialMap[level];
  const name = customName || `${rankTitles[rankIdx]} Milestone ${level}`;
  const trackWord = track === "tutor" ? "Tutor" : "Student";
  return {
    id: `badge_${track}_lvl_${level}`,
    track,
    level,
    name,
    tier,
    description: `${trackWord} Track: Earned by passing Level ${level} in the ${trackWord} 1,000-Level Daily Challenge.`
  };
}
var STUDENT_MILESTONE_BADGES = BADGE_MILESTONE_LEVELS.map(
  (level) => getBadgeForLevel(level, "student")
);
var TUTOR_MILESTONE_BADGES = BADGE_MILESTONE_LEVELS.map(
  (level) => getBadgeForLevel(level, "tutor")
);
function getAllMilestoneBadges(track = "student") {
  return track === "tutor" ? TUTOR_MILESTONE_BADGES : STUDENT_MILESTONE_BADGES;
}
function getDhakaDateKey(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function getPreviousDhakaDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utcMs = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1e3;
  return new Date(utcMs).toISOString().slice(0, 10);
}
function createRng(seed) {
  let state = seed * 2654435761 + 1013904223 >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function buildOptions(correct, candidates, rng) {
  const uniqueDistractors = [];
  for (const c of candidates) {
    if (c !== correct && !uniqueDistractors.includes(c)) {
      uniqueDistractors.push(c);
    }
    if (uniqueDistractors.length === 3) break;
  }
  let suffix = 1;
  while (uniqueDistractors.length < 3) {
    const numeric = Number(correct);
    const candidate = Number.isFinite(numeric) ? String(numeric + suffix * (suffix % 2 === 0 ? 2 : -1)) : `${correct} (${suffix})`;
    if (candidate !== correct && !uniqueDistractors.includes(candidate)) {
      uniqueDistractors.push(candidate);
    }
    suffix += 1;
  }
  const options = [correct, ...uniqueDistractors];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    options,
    correctIndex: options.indexOf(correct)
  };
}
function getTierName(level, track) {
  if (track === "tutor") {
    if (level <= 100) return "Mentor Foundation (Levels 1\u2013100)";
    if (level <= 250) return "Pedagogy & Concept Depth (Levels 101\u2013250)";
    if (level <= 500) return "Senior Lecturer Track (Levels 251\u2013500)";
    if (level <= 750) return "Faculty Honors Mastery (Levels 501\u2013750)";
    if (level <= 900) return "Olympiad Coaching Sprint (Levels 751\u2013900)";
    return "Provost Grandmaster Ascent (Levels 901\u20131000)";
  }
  if (level <= 100) return "Foundation Stage (Levels 1\u2013100)";
  if (level <= 250) return "Core Builder (Levels 101\u2013250)";
  if (level <= 500) return "Analytical Track (Levels 251\u2013500)";
  if (level <= 750) return "Honors Mastery (Levels 501\u2013750)";
  if (level <= 900) return "Olympiad Sprint (Levels 751\u2013900)";
  return "Grandmaster Ascent (Levels 901\u20131000)";
}
function generateStudentMath(level, slotId, rng) {
  const variant = (level * 3 + randInt(rng, 0, 7)) % 8;
  if (variant === 0) {
    const a = randInt(rng, 2, 6 + Math.floor(level / 140));
    const x = randInt(rng, 2, 12 + Math.floor(level / 90));
    const b = randInt(rng, 3, 24);
    const c = a * x + b;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(x),
      [String(x + 1), String(x - 1), String(x + 2), String(Math.max(1, x - 2))],
      rng
    );
    return {
      id: slotId,
      subject: "Mathematics",
      prompt: `Solve for x: ${a}x + ${b} = ${c}`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Subtract ${b} to get ${a}x = ${c - b}, then divide by ${a} so x = ${x}.`
    };
  }
  if (variant === 1) {
    const a1 = randInt(rng, 2, 14);
    const d = randInt(rng, 3, 9 + Math.floor(level / 160));
    const n2 = randInt(rng, 5, 14);
    const ans = a1 + (n2 - 1) * d;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(ans),
      [String(ans + d), String(ans - d), String(a1 + n2 * d), String(ans + 2)],
      rng
    );
    return {
      id: slotId,
      subject: "Mathematics",
      prompt: `Find the ${n2}th term of the arithmetic sequence starting at ${a1} with common difference ${d}.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `T\u2099 = a + (n \u2212 1)d = ${a1} + (${n2} \u2212 1) \xD7 ${d} = ${ans}.`
    };
  }
  if (variant === 2) {
    const r1 = randInt(rng, 2, 9);
    const r2 = randInt(rng, r1 + 1, 14);
    const sum = r1 + r2;
    const prod = r1 * r2;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(prod),
      [String(sum), String(prod + r1), String(Math.max(2, prod - r2)), String(r1 * r1 + r2)],
      rng
    );
    return {
      id: slotId,
      subject: "Mathematics",
      prompt: `If the roots of x\xB2 \u2212 ${sum}x + k = 0 are ${r1} and ${r2}, what is k?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `By Vieta's formula, k = product of roots = ${r1} \xD7 ${r2} = ${prod}.`
    };
  }
  if (variant === 3) {
    const pct = pick(rng, [10, 15, 20, 25, 30, 40]);
    const base = randInt(rng, 4, 18) * 20;
    const ans = base * pct / 100;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(ans),
      [String(ans + 10), String(Math.max(5, ans - 10)), String(base - ans), String(ans * 2)],
      rng
    );
    return {
      id: slotId,
      subject: "Mathematics",
      prompt: `A textbook priced at \u09F3${base} gets a ${pct}% student discount. How much money is saved?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `${pct}% of ${base} = (${pct} / 100) \xD7 ${base} = ${ans}.`
    };
  }
  if (variant === 4) {
    const dx = pick(rng, [3, 5, 6, 8, 9]);
    const dy = dx === 3 ? 4 : dx === 5 ? 12 : dx === 6 ? 8 : dx === 8 ? 15 : 12;
    const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
    const x1 = randInt(rng, 1, 5);
    const y1 = randInt(rng, 1, 5);
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(dist),
      [String(dx + dy), String(dist + 2), String(Math.max(1, dist - 1)), String(dy)],
      rng
    );
    return {
      id: slotId,
      subject: "Mathematics",
      prompt: `Find the Euclidean distance between points A(${x1}, ${y1}) and B(${x1 + dx}, ${y1 + dy}).`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Distance = \u221A(${dx}\xB2 + ${dy}\xB2) = \u221A(${dx * dx + dy * dy}) = ${dist}.`
    };
  }
  if (variant === 5) {
    const a = randInt(rng, 2, 7);
    const b = randInt(rng, 2, 11);
    const xVal = randInt(rng, 1, 4);
    const ans = 2 * a * xVal + b;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(ans),
      [String(a * xVal + b), String(2 * a * xVal), String(ans + a), String(Math.max(1, ans - b))],
      rng
    );
    return {
      id: slotId,
      subject: "Mathematics",
      prompt: `Given f(x) = ${a}x\xB2 + ${b}x + 5, compute the derivative f'(${xVal}).`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `f'(x) = ${2 * a}x + ${b}, so f'(${xVal}) = ${2 * a}(${xVal}) + ${b} = ${ans}.`
    };
  }
  if (variant === 6) {
    const base = pick(rng, [2, 3, 5]);
    const exp = randInt(rng, 2, 5);
    const val = Math.pow(base, exp);
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(exp),
      [String(exp + 1), String(Math.max(1, exp - 1)), String(base), String(exp + 2)],
      rng
    );
    return {
      id: slotId,
      subject: "Mathematics",
      prompt: `Evaluate the logarithm: log_${base}(${val}) = ?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Since ${base}^${exp} = ${val}, log_${base}(${val}) = ${exp}.`
    };
  }
  const n = randInt(rng, 5, 8);
  const k = 2;
  const comb = n * (n - 1) / 2;
  const { options, correctIndex } = buildOptions(
    String(comb),
    [String(n * (n - 1)), String(comb + n), String(Math.max(3, comb - 3)), String(n * k)],
    rng
  );
  return {
    id: slotId,
    subject: "Mathematics",
    prompt: `In how many ways can a study group choose ${k} team captains out of ${n} students?`,
    options,
    correctIndex,
    explanation: `C(${n}, 2) = ${n} \xD7 (${n} \u2212 1) / 2 = ${comb}.`
  };
}
var STUDENT_PHYSICS_CONCEPTS = [
  {
    prompt: "Which SI unit measures electrical resistance?",
    correct: "Ohm (\u03A9)",
    distractors: ["Watt (W)", "Coulomb (C)", "Tesla (T)"],
    explanation: "Electrical resistance R = V / I is measured in Ohms (\u03A9)."
  },
  {
    prompt: "When light passes from air into glass, its frequency:",
    correct: "Remains constant while wavelength decreases",
    distractors: [
      "Doubles while speed stays constant",
      "Drops to zero at the boundary",
      "Increases along with its speed"
    ],
    explanation: "Frequency is fixed by the source; speed and wavelength decrease in a denser medium."
  },
  {
    prompt: "Which law explains why passengers lurch forward when a bus brakes suddenly?",
    correct: "Newton's First Law (Inertia)",
    distractors: ["Pascal's Principle", "Archimedes' Principle", "Hooke's Law"],
    explanation: "Inertia keeps the body moving forward at constant velocity unless an external force acts."
  },
  {
    prompt: "In a vacuum, which electromagnetic wave has the shortest wavelength?",
    correct: "Gamma rays",
    distractors: ["Microwaves", "Infrared waves", "Visible red light"],
    explanation: "Gamma rays carry the highest frequency and shortest wavelength in the EM spectrum."
  }
];
function generateStudentPhysics(level, slotId, rng) {
  const variant = (level * 5 + randInt(rng, 0, 5)) % 6;
  if (variant === 0) {
    const u = randInt(rng, 2, 12);
    const a = randInt(rng, 2, 6);
    const t = randInt(rng, 3, 9);
    const v = u + a * t;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${v} m/s`,
      [`${u + a + t} m/s`, `${v + a} m/s`, `${Math.max(1, v - t)} m/s`, `${a * t} m/s`],
      rng
    );
    return {
      id: slotId,
      subject: "Physics",
      prompt: `A cyclist starts at ${u} m/s and accelerates at ${a} m/s\xB2 for ${t} s. Find the final speed.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `v = u + at = ${u} + ${a} \xD7 ${t} = ${v} m/s.`
    };
  }
  if (variant === 1) {
    const m = randInt(rng, 2, 10);
    const v = randInt(rng, 2, 6) * 2;
    const ke = 0.5 * m * v * v;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${ke} J`,
      [`${m * v} J`, `${m * v * v} J`, `${ke + m * v} J`, `${Math.max(4, ke / 2)} J`],
      rng
    );
    return {
      id: slotId,
      subject: "Physics",
      prompt: `What is the kinetic energy of a ${m} kg ball moving at ${v} m/s?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `KE = \xBDmv\xB2 = 0.5 \xD7 ${m} \xD7 ${v}\xB2 = ${ke} J.`
    };
  }
  if (variant === 2) {
    const i = randInt(rng, 2, 8);
    const r = randInt(rng, 3, 14);
    const v = i * r;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${v} V`,
      [`${i + r} V`, `${v + r} V`, `${Math.max(2, v - i)} V`, `${r} V`],
      rng
    );
    return {
      id: slotId,
      subject: "Physics",
      prompt: `A ${r} \u03A9 lamp carries a current of ${i} A. What voltage drops across it?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Ohm's Law: V = I \xD7 R = ${i} \xD7 ${r} = ${v} V.`
    };
  }
  if (variant === 3) {
    const f = randInt(rng, 10, 50);
    const lam = randInt(rng, 2, 7);
    const speed = f * lam;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${speed} m/s`,
      [`${f + lam} m/s`, `${speed + f} m/s`, `${Math.round(f / lam)} m/s`, `${speed * 2} m/s`],
      rng
    );
    return {
      id: slotId,
      subject: "Physics",
      prompt: `A sound wave has frequency ${f} Hz and wavelength ${lam} m. Calculate its speed.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `v = f\u03BB = ${f} \xD7 ${lam} = ${speed} m/s.`
    };
  }
  if (variant === 4) {
    const work = randInt(rng, 4, 15) * 30;
    const time = pick(rng, [3, 5, 6, 10]);
    const power = work / time;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${power} W`,
      [`${work * time} W`, `${power + 15} W`, `${Math.max(5, power - 10)} W`, `${work} W`],
      rng
    );
    return {
      id: slotId,
      subject: "Physics",
      prompt: `A motor performs ${work} J of work in ${time} seconds. What is its average power output?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Power P = W / t = ${work} / ${time} = ${power} W.`
    };
  }
  const fact = STUDENT_PHYSICS_CONCEPTS[(level - 1) % STUDENT_PHYSICS_CONCEPTS.length];
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: "Physics",
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation
  };
}
var STUDENT_CHEM_CONCEPTS = [
  {
    prompt: "Which gas law states pressure and volume vary inversely at constant temperature?",
    correct: "Boyle's Law",
    distractors: ["Charles's Law", "Avogadro's Law", "Dalton's Law"],
    explanation: "Boyle's Law states P\u2081V\u2081 = P\u2082V\u2082 when temperature and moles stay fixed."
  },
  {
    prompt: "What type of bond forms by sharing electron pairs between non-metals?",
    correct: "Covalent bond",
    distractors: ["Ionic bond", "Metallic bond", "Van der Waals force"],
    explanation: "Non-metal atoms achieve stable octets by sharing valence electron pairs."
  },
  {
    prompt: "Which subatomic particle determines the atomic number of an element?",
    correct: "Proton",
    distractors: ["Neutron", "Electron", "Alpha particle"],
    explanation: "Atomic number Z equals the number of protons inside the atomic nucleus."
  },
  {
    prompt: "What is the hybridization of the carbon atom in methane (CH\u2084)?",
    correct: "sp\xB3",
    distractors: ["sp", "sp\xB2", "sp\xB3d"],
    explanation: "Carbon in CH\u2084 forms four single sigma bonds in a tetrahedral sp\xB3 arrangement."
  },
  {
    prompt: "Which halogen exists as a liquid at standard room temperature?",
    correct: "Bromine (Br\u2082)",
    distractors: ["Fluorine (F\u2082)", "Chlorine (Cl\u2082)", "Iodine (I\u2082)"],
    explanation: "Bromine is the only non-metal liquid at 25\xB0C and 1 atm."
  },
  {
    prompt: "During oxidation in a chemical reaction, a species:",
    correct: "Loses electrons",
    distractors: ["Gains electrons", "Loses protons", "Decreases oxidation number"],
    explanation: "OIL RIG: Oxidation Is Loss of electrons (increasing oxidation state)."
  }
];
function generateStudentChemistry(level, slotId, rng) {
  const variant = (level * 7 + randInt(rng, 0, 3)) % 4;
  if (variant === 0) {
    const moles = randInt(rng, 2, 9);
    const liters = pick(rng, [1, 2, 4]);
    const m = moles / liters;
    const formatted = Number.isInteger(m) ? `${m} M` : `${m.toFixed(2)} M`;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      formatted,
      [`${moles + liters} M`, `${(m + 1).toFixed(Number.isInteger(m) ? 0 : 2)} M`, `${(m * 2).toFixed(Number.isInteger(m) ? 0 : 2)} M`],
      rng
    );
    return {
      id: slotId,
      subject: "Chemistry",
      prompt: `Find the molarity when ${moles} moles of NaCl are dissolved in ${liters} L of solution.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Molarity = moles / liters = ${moles} / ${liters} = ${formatted}.`
    };
  }
  if (variant === 1) {
    const exp = randInt(rng, 1, 6);
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(exp),
      [String(exp + 1), String(14 - exp), String(exp + 2), "7"],
      rng
    );
    return {
      id: slotId,
      subject: "Chemistry",
      prompt: `An acidic solution has [H\u207A] = 10\u207B${exp} mol/L at 25\xB0C. What is its pH?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `pH = \u2212log\u2081\u2080[H\u207A] = \u2212log\u2081\u2080(10\u207B${exp}) = ${exp}.`
    };
  }
  if (variant === 2) {
    const compounds = [
      { formula: "H\u2082O", mass: 18, detail: "2(1) + 16 = 18" },
      { formula: "CO\u2082", mass: 44, detail: "12 + 2(16) = 44" },
      { formula: "CH\u2084", mass: 16, detail: "12 + 4(1) = 16" },
      { formula: "NH\u2083", mass: 17, detail: "14 + 3(1) = 17" },
      { formula: "NaOH", mass: 40, detail: "23 + 16 + 1 = 40" },
      { formula: "CaCO\u2083", mass: 100, detail: "40 + 12 + 3(16) = 100" }
    ];
    const chosen = compounds[(level + randInt(rng, 0, compounds.length - 1)) % compounds.length];
    const moles = randInt(rng, 2, 4);
    const totalMass = chosen.mass * moles;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${totalMass} g`,
      [`${chosen.mass} g`, `${totalMass + chosen.mass} g`, `${totalMass - 8} g`, `${chosen.mass + moles} g`],
      rng
    );
    return {
      id: slotId,
      subject: "Chemistry",
      prompt: `What is the mass in grams of ${moles} moles of ${chosen.formula}?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Molar mass of ${chosen.formula} is ${chosen.detail} g/mol. ${moles} mol \xD7 ${chosen.mass} g/mol = ${totalMass} g.`
    };
  }
  const fact = STUDENT_CHEM_CONCEPTS[(level - 1) % STUDENT_CHEM_CONCEPTS.length];
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: "Chemistry",
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation
  };
}
var STUDENT_BIOLOGY_BANK = [
  {
    prompt: "Which organelle synthesizes most of the cell\u2019s ATP via aerobic respiration?",
    correct: "Mitochondrion",
    distractors: ["Golgi apparatus", "Lysosome", "Ribosome"],
    explanation: "Mitochondria carry out the Krebs cycle and oxidative phosphorylation to generate ATP."
  },
  {
    prompt: "In DNA, which nitrogenous base pairs exclusively with Cytosine (C)?",
    correct: "Guanine (G)",
    distractors: ["Adenine (A)", "Thymine (T)", "Uracil (U)"],
    explanation: "Chargaff\u2019s base-pairing rule pairs G with C via three hydrogen bonds and A with T via two."
  },
  {
    prompt: "Which hormone lowers blood glucose levels by promoting cellular glucose uptake?",
    correct: "Insulin",
    distractors: ["Glucagon", "Adrenaline", "Thyroxine"],
    explanation: "Pancreatic beta cells secrete insulin to move glucose from blood into muscle and liver cells."
  },
  {
    prompt: "What is the functional filtration unit inside each human kidney?",
    correct: "Nephron",
    distractors: ["Alveolus", "Neuron", "Sarcomere"],
    explanation: "Millions of nephrons filter blood plasma, reabsorb nutrients, and produce urine."
  },
  {
    prompt: "During photosynthesis, oxygen gas (O\u2082) is released from the splitting of:",
    correct: "Water (H\u2082O)",
    distractors: ["Carbon dioxide (CO\u2082)", "Glucose (C\u2086H\u2081\u2082O\u2086)", "Chlorophyll"],
    explanation: "Photolysis of water during the light-dependent reactions produces electrons, H\u207A, and O\u2082."
  },
  {
    prompt: "Which plant vascular tissue transports dissolved sugars from leaves to roots?",
    correct: "Phloem",
    distractors: ["Xylem", "Cambium", "Epidermis"],
    explanation: "Phloem carries sucrose and nutrients bidirectionally; xylem conducts water upward."
  },
  {
    prompt: "Mitosis produces two daughter cells that are:",
    correct: "Genetically identical and diploid (2n)",
    distractors: [
      "Genetically unique and haploid (n)",
      "Four gametes with half the DNA",
      "Devoid of nuclear membranes"
    ],
    explanation: "Mitosis preserves chromosome number (2n \u2192 2n) for growth and tissue repair."
  },
  {
    prompt: "Which blood cells are primarily responsible for carrying oxygen via hemoglobin?",
    correct: "Red blood cells (Erythrocytes)",
    distractors: ["White blood cells (Leukocytes)", "Platelets", "Plasma proteins"],
    explanation: "Erythrocytes are packed with iron-rich hemoglobin molecules that bind O\u2082."
  }
];
function generateStudentBiology(level, slotId, rng) {
  const item = STUDENT_BIOLOGY_BANK[(level - 1) % STUDENT_BIOLOGY_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: "Biology",
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation
  };
}
var STUDENT_ICT_CONCEPTS = [
  {
    prompt: "What is the worst-case time complexity of Binary Search on a sorted list of n items?",
    correct: "O(log n)",
    distractors: ["O(1)", "O(n)", "O(n log n)"],
    explanation: "Binary search halves the remaining interval each step, taking at most log\u2082(n) steps."
  },
  {
    prompt: "Which data structure follows Last-In, First-Out (LIFO) order?",
    correct: "Stack",
    distractors: ["Queue", "Hash Table", "Linked List"],
    explanation: "Items pushed onto the top of a Stack are popped off first (LIFO)."
  },
  {
    prompt: "In relational SQL databases, which key uniquely identifies every row in a table?",
    correct: "PRIMARY KEY",
    distractors: ["FOREIGN KEY", "INDEX BY", "ORDER BY"],
    explanation: "A PRIMARY KEY enforces uniqueness and non-null values across all rows."
  },
  {
    prompt: "In Boolean logic, what is the output of (1 AND 0) OR (NOT 0)?",
    correct: "1",
    distractors: ["0", "Undefined", "-1"],
    explanation: "(1 AND 0) = 0, (NOT 0) = 1, and 0 OR 1 = 1."
  },
  {
    prompt: "Which logic gate outputs 1 ONLY when both inputs are different (one 1 and one 0)?",
    correct: "XOR gate",
    distractors: ["AND gate", "OR gate", "NOR gate"],
    explanation: "Exclusive-OR (XOR) returns true strictly when its two inputs differ."
  },
  {
    prompt: "Which protocol secures HTTP web traffic with end-to-end encryption?",
    correct: "HTTPS (TLS)",
    distractors: ["FTP", "SMTP", "Telnet"],
    explanation: "HTTPS wraps HTTP over Transport Layer Security (TLS) for encrypted communication."
  }
];
function generateStudentIct(level, slotId, rng) {
  const variant = (level * 5 + randInt(rng, 0, 3)) % 4;
  if (variant === 0) {
    const val = randInt(rng, 10, 63 + Math.min(60, Math.floor(level / 12)));
    const bin = val.toString(2);
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(val),
      [String(val + 1), String(val - 1), String(val + 4), String(Math.max(2, val - 2))],
      rng
    );
    return {
      id: slotId,
      subject: "ICT & Programming",
      prompt: `Convert the binary number ${bin}\u2082 to decimal (base 10):`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Evaluating the binary place values of ${bin}\u2082 gives ${val}.`
    };
  }
  if (variant === 1) {
    const dec = randInt(rng, 18, 250);
    const hex = dec.toString(16).toUpperCase();
    const alt1 = (dec + 1).toString(16).toUpperCase();
    const alt2 = Math.max(10, dec - 2).toString(16).toUpperCase();
    const alt3 = (dec + 16).toString(16).toUpperCase();
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(hex, [alt1, alt2, alt3], rng);
    return {
      id: slotId,
      subject: "ICT & Programming",
      prompt: `What is the hexadecimal (base 16) representation of decimal ${dec}?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `${dec} \xF7 16 gives remainder digits forming ${hex}\u2081\u2086.`
    };
  }
  if (variant === 2) {
    const start = randInt(rng, 1, 5);
    const stop = start + randInt(rng, 3, 8);
    const count = stop - start;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(count),
      [String(count + 1), String(Math.max(1, count - 1)), String(stop), String(start + stop)],
      rng
    );
    return {
      id: slotId,
      subject: "ICT & Programming",
      prompt: `In Python, what value does len(range(${start}, ${stop})) return?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `range(${start}, ${stop}) generates integers from ${start} to ${stop - 1}, so length is ${count}.`
    };
  }
  const item = STUDENT_ICT_CONCEPTS[(level - 1) % STUDENT_ICT_CONCEPTS.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: "ICT & Programming",
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation
  };
}
var STUDENT_ENGLISH_BANK = [
  {
    prompt: "Select the sentence with correct parallel structure:",
    correct: "She enjoys reading essays, solving equations, and tutoring peers.",
    distractors: [
      "She enjoys reading essays, to solve equations, and tutoring peers.",
      "She enjoys to read essays, solving equations, and tutor peers.",
      "She enjoys reading essays, solved equations, and to tutor peers."
    ],
    explanation: "Parallel items in a list must share the same grammatical form (all gerunds)."
  },
  {
    prompt: 'Choose the closest synonym for "mitigate" in academic writing:',
    correct: "Alleviate",
    distractors: ["Aggravate", "Fabricate", "Negate"],
    explanation: '"Mitigate" means to lessen severity or impact, matching "alleviate".'
  },
  {
    prompt: "Which sentence uses the semicolon accurately?",
    correct: "The lab test succeeded; however, further trials are planned.",
    distractors: [
      "Because the lab test succeeded; further trials are planned.",
      "The lab test succeeded; and further trials are planned.",
      "The lab test; however succeeded on Monday."
    ],
    explanation: 'A semicolon links two independent clauses joined by a conjunctive adverb like "however".'
  },
  {
    prompt: 'Choose the best word: "Her _____ explanation cleared up every doubt in seconds."',
    correct: "Lucid",
    distractors: ["Ambiguous", "Cryptic", "Verbose"],
    explanation: '"Lucid" means crystal clear and easy to follow.'
  },
  {
    prompt: 'Complete the third conditional: "If he _____ earlier, he would have joined the seminar."',
    correct: "had arrived",
    distractors: ["arrived", "would arrive", "has arrived"],
    explanation: 'Unreal past conditionals use "If + past perfect (had arrived), ... would have + past participle".'
  },
  {
    prompt: "Choose the correct subject-verb agreement:",
    correct: "Neither the coach nor the players were late for practice.",
    distractors: [
      "Neither the coach nor the players was late for practice.",
      "Each of the Physics notebooks have been graded.",
      "The committee of senior judges agree with none of it."
    ],
    explanation: 'With "neither ... nor", the verb agrees with the closer noun ("players" \u2192 "were").'
  },
  {
    prompt: 'Select the antonym of "ephemeral":',
    correct: "Enduring",
    distractors: ["Fleeting", "Brief", "Fragile"],
    explanation: '"Ephemeral" means short-lived; its opposite is "enduring" or permanent.'
  }
];
function generateStudentEnglish(level, slotId, rng) {
  const item = STUDENT_ENGLISH_BANK[(level - 1) % STUDENT_ENGLISH_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: "Academic English",
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation
  };
}
function generateStudentAnalytical(level, slotId, rng) {
  const variant = (level + randInt(rng, 0, 2)) % 3;
  if (variant === 0) {
    const start = randInt(rng, 2, 7);
    const mult = randInt(rng, 2, 3);
    const add = randInt(rng, 1, 5);
    const s1 = start;
    const s2 = s1 * mult + add;
    const s3 = s2 * mult + add;
    const s4 = s3 * mult + add;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(s4),
      [String(s4 + add), String(s4 - 2), String(s3 * mult), String(s4 + mult)],
      rng
    );
    return {
      id: slotId,
      subject: "Analytical Reasoning",
      prompt: `Find the next number in the sequence: ${s1}, ${s2}, ${s3}, ___`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Each term is (previous \xD7 ${mult}) + ${add}: ${s3} \xD7 ${mult} + ${add} = ${s4}.`
    };
  }
  if (variant === 1) {
    const speed = randInt(rng, 4, 12) * 5;
    const hours = randInt(rng, 2, 5);
    const dist = speed * hours;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${dist} km`,
      [`${speed + hours} km`, `${dist + speed} km`, `${Math.max(10, dist - 20)} km`, `${speed * 2} km`],
      rng
    );
    return {
      id: slotId,
      subject: "Analytical Reasoning",
      prompt: `A train travels steadily at ${speed} km/h for ${hours} hours. What distance does it cover?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Distance = Speed \xD7 Time = ${speed} \xD7 ${hours} = ${dist} km.`
    };
  }
  const fact = {
    prompt: 'What is the logical negation of "All students completed the assignment"?',
    correct: "At least one student did not complete the assignment.",
    distractors: [
      "No student completed the assignment.",
      "All students failed the assignment.",
      "Most students completed the assignment."
    ],
    explanation: 'Negating a universal claim ("All P") requires only one counterexample ("At least one is not P").'
  };
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: "Analytical Reasoning",
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation
  };
}
var TUTOR_PEDAGOGY_BANK = [
  {
    prompt: "In Vygotsky's framework, what defines a student's Zone of Proximal Development (ZPD)?",
    correct: "Tasks a learner can master with guided scaffolding but not yet alone",
    distractors: [
      "Topics already mastered independently without feedback",
      "Memorizing formulas before conceptual intuition",
      "Material far beyond prerequisite skills even with hints"
    ],
    explanation: "Effective tutoring targets the ZPD \u2014 challenging enough to stretch reasoning, supported by targeted scaffolding."
  },
  {
    prompt: "Which study method yields the highest long-term exam retention according to cognitive research?",
    correct: "Spaced active retrieval practice mixed with interleaved problems",
    distractors: [
      "Passive massed re-reading of highlighted notes before exams",
      "Copying worked solutions verbatim multiple times",
      "Blocking 50 identical problems before reviewing concepts"
    ],
    explanation: "Spacing + retrieval practice + interleaving strengthens neural recall pathways far more than passive re-reading."
  },
  {
    prompt: "A student consistently writes (a + b)\xB2 = a\xB2 + b\xB2. What is the strongest diagnostic tutoring response?",
    correct: "Ask them to plug in a = 2, b = 3 to discover the missing 2ab term themselves",
    distractors: [
      "Give 20 repetitive drills without discussing why it failed",
      "Tell them to memorize the formula faster next time",
      "Move directly to multivariable calculus"
    ],
    explanation: "Counterexample testing helps learners confront and permanently correct structural algebraic misconceptions."
  },
  {
    prompt: "Which action exemplifies Formative Assessment during a live 1-on-1 tuition session?",
    correct: "Pausing mid-lesson for a quick 2-minute check question to adapt pacing",
    distractors: [
      "Waiting until the final monthly exam to identify weak chapters",
      "Assigning grades without written diagnostic feedback",
      "Lecturing uninterrupted for 90 minutes to finish the chapter"
    ],
    explanation: "Formative checks provide real-time evidence so a tutor can recalibrate explanations before gaps compound."
  },
  {
    prompt: 'On Bloom\u2019s Revised Taxonomy, asking a student to "design an experiment testing Ohm\u2019s Law" targets:',
    correct: "Creating (highest-order cognitive skill)",
    distractors: [
      "Remembering (basic recall)",
      "Understanding (paraphrasing only)",
      "Recognizing definitions"
    ],
    explanation: "Designing original investigations or solutions sits at the top synthesis/Creating tier of Bloom\u2019s Taxonomy."
  },
  {
    prompt: "When managing a mixed-ability tuition batch of 8 students, how should a tutor differentiate?",
    correct: "Use tiered problem sets (core \u2192 stretch) while keeping one shared conceptual anchor",
    distractors: [
      "Teach exclusively at the pace of the fastest student",
      "Skip foundational explanations for everyone",
      "Avoid giving feedback to weaker students publicly or privately"
    ],
    explanation: "Tiered tasks preserve whole-group cohesion while keeping both struggling and advanced learners appropriately stretched."
  },
  {
    prompt: "In Socratic tutoring, why does a mentor respond to a student\u2019s guess with a probing follow-up question?",
    correct: "To help the learner trace their own reasoning and uncover hidden assumptions",
    distractors: [
      "To delay giving the syllabus schedule",
      "To conceal whether the answer was right or wrong indefinitely",
      "To replace worked examples completely"
    ],
    explanation: "Socratic questioning builds metacognition so students learn how to self-verify during real exams."
  },
  {
    prompt: "Which rubric design practice makes CQ (written exam) grading clearest for students?",
    correct: "Breaking marks into explicit criteria: setup/formula, algebraic step, and unit accuracy",
    distractors: [
      "Assigning a single holistic letter grade with no step breakdown",
      "Deducting random points for handwriting style",
      "Only grading the final numerical line"
    ],
    explanation: "Analytic criterion rubrics teach students exactly how partial credit works in board and admission exams."
  },
  {
    prompt: 'What is "scaffolding fade" in long-term academic mentorship?',
    correct: "Gradually removing hints and templates as the student gains independent fluency",
    distractors: [
      "Adding extra formula sheets before every mock test",
      "Solving the first half of every exam question for the student permanently",
      "Canceling weekly practice reviews once scores rise once"
    ],
    explanation: "Scaffolds are temporary supports meant to be faded out so learners perform independently under exam pressure."
  },
  {
    prompt: "A high-performing student freezes under timed mock tests despite strong homework scores. What should the tutor introduce?",
    correct: "Short timed micro-sprints (e.g., 10-minute checkpoints) with calm triage strategies",
    distractors: [
      "Eliminate all time limits until exam week",
      "Increase daily homework volume without practicing pacing",
      "Tell them never to skip any hard question first"
    ],
    explanation: "Low-stakes timed micro-sprints desensitize test anxiety and train smart question-triage habits."
  }
];
function generateTutorPedagogy(level, slotId, rng) {
  const item = TUTOR_PEDAGOGY_BANK[(level - 1) % TUTOR_PEDAGOGY_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: "Pedagogy & Mentorship",
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation
  };
}
function generateTutorAdvancedMath(level, slotId, rng) {
  const variant = (level * 5 + randInt(rng, 0, 5)) % 6;
  if (variant === 0) {
    const k2 = randInt(rng, 1, 4);
    const c = randInt(rng, 1, 5);
    const b = randInt(rng, 2, 4);
    const ans = k2 * Math.pow(b, 3) + c * Math.pow(b, 2);
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(ans),
      [String(ans + b), String(3 * k2 * b * b + 2 * c * b), String(Math.max(4, ans - c * b)), String(ans * 2)],
      rng
    );
    return {
      id: slotId,
      subject: "Advanced Calculus & Algebra",
      prompt: `Evaluate the definite integral: \u222B\u2080^${b} (${3 * k2}x\xB2 + ${2 * c}x) dx`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Antiderivative is ${k2}x\xB3 + ${c}x\xB2. Evaluating from 0 to ${b} gives ${k2}(${b}\xB3) + ${c}(${b}\xB2) = ${ans}.`
    };
  }
  if (variant === 1) {
    const a = randInt(rng, 3, 9);
    const b = randInt(rng, 2, 7);
    const c = randInt(rng, 1, 5);
    const d = randInt(rng, 3, 9);
    const det = a * d - b * c;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(det),
      [String(a * d + b * c), String(det + b), String(det - c), String(a * b - c * d)],
      rng
    );
    return {
      id: slotId,
      subject: "Linear Algebra",
      prompt: `Compute the determinant of the 2\xD72 matrix [[${a}, ${b}], [${c}, ${d}]].`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `det(A) = (${a} \xD7 ${d}) \u2212 (${b} \xD7 ${c}) = ${a * d} \u2212 ${b * c} = ${det}.`
    };
  }
  if (variant === 2) {
    const a = randInt(rng, 1, 4);
    const xMax = randInt(rng, 2, 7);
    const b = 2 * a * xMax;
    const c = randInt(rng, 3, 15);
    const maxVal = -a * xMax * xMax + b * xMax + c;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(maxVal),
      [String(xMax), String(maxVal + a), String(c), String(maxVal - xMax)],
      rng
    );
    return {
      id: slotId,
      subject: "Advanced Calculus & Algebra",
      prompt: `Find the global maximum value of the quadratic function f(x) = \u2212${a}x\xB2 + ${b}x + ${c}.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `f'(x) = \u2212${2 * a}x + ${b} = 0 gives x = ${xMax}. Substituting yields f(${xMax}) = ${maxVal}.`
    };
  }
  if (variant === 3) {
    const k2 = pick(rng, [2, 3, 4]);
    const a = randInt(rng, 2, 6) * (k2 - 1);
    const sum = a * k2 / (k2 - 1);
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(sum),
      [String(a * k2), String(sum + a), String(Math.max(2, sum - k2)), String(a + k2)],
      rng
    );
    return {
      id: slotId,
      subject: "Infinite Series & Olympiad Math",
      prompt: `Compute the sum to infinity of the geometric series with first term a = ${a} and common ratio r = 1/${k2}.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `S\u221E = a / (1 \u2212 1/${k2}) = ${a} \xD7 ${k2} / ${k2 - 1} = ${sum}.`
    };
  }
  if (variant === 4) {
    const base = randInt(rng, 2, 6);
    const exp = randInt(rng, 5, 8);
    const mod = pick(rng, [7, 11, 13]);
    let rem = 1;
    for (let i = 0; i < exp; i += 1) {
      rem = rem * base % mod;
    }
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(rem),
      [String((rem + 1) % mod), String((rem + 2) % mod), String((rem + 3) % mod), String(mod - 1)],
      rng
    );
    return {
      id: slotId,
      subject: "Number Theory",
      prompt: `Using modular arithmetic, find ${base}^${exp} mod ${mod}.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Repeated squaring modulo ${mod} reduces ${base}^${exp} to remainder ${rem}.`
    };
  }
  const v1 = randInt(rng, 2, 6);
  const v2 = randInt(rng, 3, 8);
  const w1 = randInt(rng, 2, 5);
  const k = -(v1 * w1) / v2;
  const cleanW1 = v2;
  const cleanAns = -v1;
  const { options, correctIndex } = buildOptions(
    String(cleanAns),
    [String(v1), String(cleanW1), String(cleanAns - 2), String(0)],
    rng
  );
  void k;
  void w1;
  return {
    id: slotId,
    subject: "Vector Geometry",
    prompt: `For what value of \u03BB are vectors u = (${v1}, ${v2}) and v = (${cleanW1}, \u03BB) orthogonal?`,
    options,
    correctIndex,
    explanation: `Orthogonal vectors satisfy u \xB7 v = 0 \u2192 ${v1}(${cleanW1}) + ${v2}\u03BB = 0 \u2192 \u03BB = ${cleanAns}.`
  };
}
function generateTutorAdvancedPhysics(level, slotId, rng) {
  const variant = (level * 3 + randInt(rng, 0, 4)) % 5;
  if (variant === 0) {
    const pairs = [
      [6, 3, 2],
      [12, 4, 3],
      [10, 10, 5],
      [12, 6, 4],
      [15, 10, 6],
      [20, 5, 4]
    ];
    const [r1, r2, req] = pairs[(level + randInt(rng, 0, pairs.length - 1)) % pairs.length];
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${req} \u03A9`,
      [`${r1 + r2} \u03A9`, `${Math.round((r1 + r2) / 2)} \u03A9`, `${req + 2} \u03A9`, `${r1} \u03A9`],
      rng
    );
    return {
      id: slotId,
      subject: "Electromagnetism & Circuits",
      prompt: `Two resistors of ${r1} \u03A9 and ${r2} \u03A9 are connected in parallel. What is their equivalent resistance?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `1/Req = 1/${r1} + 1/${r2} \u2192 Req = (${r1}\xD7${r2})/(${r1}+${r2}) = ${req} \u03A9.`
    };
  }
  if (variant === 1) {
    const c = randInt(rng, 2, 8) * 2;
    const v = randInt(rng, 5, 12);
    const energy = 0.5 * c * v * v;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${energy} \xB5J`,
      [`${c * v} \xB5J`, `${c * v * v} \xB5J`, `${energy + c} \xB5J`, `${Math.round(energy / 2)} \xB5J`],
      rng
    );
    return {
      id: slotId,
      subject: "Electromagnetism & Circuits",
      prompt: `A ${c} \xB5F capacitor is charged to ${v} V. How much electrostatic energy is stored in it?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `U = \xBDCV\xB2 = 0.5 \xD7 ${c} \xB5F \xD7 (${v} V)\xB2 = ${energy} \xB5J.`
    };
  }
  if (variant === 2) {
    const vy = randInt(rng, 2, 7) * 5;
    const tFlight = 2 * vy / 10;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${tFlight} s`,
      [`${vy / 10} s`, `${tFlight + 2} s`, `${tFlight * 2} s`, `${Math.max(1, tFlight - 1)} s`],
      rng
    );
    return {
      id: slotId,
      subject: "Classical Mechanics",
      prompt: `A projectile is launched over flat ground with initial vertical velocity component v_y = ${vy} m/s (take g = 10 m/s\xB2). Find the total time of flight.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `Time of flight T = 2v_y / g = (2 \xD7 ${vy}) / 10 = ${tFlight} s.`
    };
  }
  if (variant === 3) {
    const r = randInt(rng, 2, 6);
    const f = randInt(rng, 10, 35);
    const torque = r * f;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${torque} N\xB7m`,
      [`${f / r} N\xB7m`, `${torque + f} N\xB7m`, `${f + r} N\xB7m`, `${torque * 2} N\xB7m`],
      rng
    );
    return {
      id: slotId,
      subject: "Rotational Mechanics",
      prompt: `A force of ${f} N is applied perpendicularly at a lever arm of ${r} m from the pivot. What is the torque magnitude?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `\u03C4 = rF sin(90\xB0) = ${r} \xD7 ${f} = ${torque} N\xB7m.`
    };
  }
  const fact = {
    prompt: "In the photoelectric effect, increasing the incident light frequency (above threshold) directly increases:",
    correct: "The maximum kinetic energy of emitted photoelectrons",
    distractors: [
      "The work function of the metal surface",
      "The Planck constant",
      "Only the number of emitted electrons per second at fixed intensity"
    ],
    explanation: "By Einstein\u2019s equation K_max = hf \u2212 \u03A6, higher frequency f raises K_max linearly."
  };
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: "Modern Physics",
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation
  };
}
var TUTOR_CHEM_BANK = [
  {
    prompt: "When \u0394H < 0 and \u0394S > 0 for a chemical process, Gibbs free energy \u0394G = \u0394H \u2212 T\u0394S indicates the reaction is:",
    correct: "Spontaneous at all temperatures",
    distractors: [
      "Non-spontaneous at all temperatures",
      "Spontaneous only at low temperatures",
      "Always at chemical equilibrium"
    ],
    explanation: "With \u0394H negative and \u2212T\u0394S negative (since \u0394S > 0, T > 0), \u0394G < 0 at every temperature."
  },
  {
    prompt: "In a buffer where weak acid concentration equals its conjugate base ([HA] = [A\u207B]), the pH equals:",
    correct: "pK\u2090",
    distractors: ["14 \u2212 pK\u2090", "7.00 always", "2 \xD7 pK\u2090"],
    explanation: "Henderson\u2013Hasselbalch: pH = pK\u2090 + log\u2081\u2080([A\u207B]/[HA]) = pK\u2090 + log\u2081\u2080(1) = pK\u2090."
  },
  {
    prompt: "For the gas-phase equilibrium N\u2082(g) + 3H\u2082(g) \u21CC 2NH\u2083(g), increasing pressure at constant T shifts equilibrium:",
    correct: "Toward NH\u2083 (side with fewer gas moles)",
    distractors: [
      "Toward N\u2082 and H\u2082 (more gas moles)",
      "Nowhere, because Kp never responds to volume",
      "To halt the forward rate"
    ],
    explanation: "By Le Chatelier\u2019s Principle, higher pressure favors 2 moles of NH\u2083 over 4 moles of reactants."
  },
  {
    prompt: "Which thermodynamic function determines the equilibrium constant K via \u0394G\xB0 = \u2212RT ln K?",
    correct: "Standard Gibbs free energy change (\u0394G\xB0)",
    distractors: ["Activation energy (E\u2090)", "Bond order", "Molar conductivity"],
    explanation: "\u0394G\xB0 governs thermodynamic favorability and K; E\u2090 governs reaction rate."
  }
];
function generateTutorChemistry(level, slotId, rng) {
  const variant = (level * 7 + randInt(rng, 0, 2)) % 3;
  if (variant === 0) {
    const halfLife = randInt(rng, 2, 6);
    const periods = randInt(rng, 2, 4);
    const totalTime = halfLife * periods;
    const startMass = Math.pow(2, periods) * randInt(rng, 3, 7);
    const remaining = startMass / Math.pow(2, periods);
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${remaining} g`,
      [`${startMass / 2} g`, `${remaining * 2} g`, `${Math.max(1, remaining - 2)} g`, `${startMass / periods} g`],
      rng
    );
    return {
      id: slotId,
      subject: "Physical Chemistry",
      prompt: `A first-order sample of ${startMass} g has a half-life of ${halfLife} hours. How much remains after ${totalTime} hours?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `${totalTime} / ${halfLife} = ${periods} half-lives. Remaining mass = ${startMass} / 2^${periods} = ${remaining} g.`
    };
  }
  if (variant === 1) {
    const eCathode = pick(rng, [0.34, 0.8, 1.36]);
    const eAnode = pick(rng, [-0.76, -0.44, -0.25]);
    const eCell = Number((eCathode - eAnode).toFixed(2));
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      `${eCell.toFixed(2)} V`,
      [
        `${(eCathode + eAnode).toFixed(2)} V`,
        `${(eCell + 0.5).toFixed(2)} V`,
        `${(eAnode - eCathode).toFixed(2)} V`
      ],
      rng
    );
    return {
      id: slotId,
      subject: "Electrochemistry",
      prompt: `A galvanic cell pairs a cathode reduction potential of +${eCathode.toFixed(2)} V with an anode reduction potential of ${eAnode.toFixed(2)} V. Compute E\xB0_cell.`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `E\xB0_cell = E\xB0_cathode \u2212 E\xB0_anode = ${eCathode.toFixed(2)} \u2212 (${eAnode.toFixed(2)}) = ${eCell.toFixed(2)} V.`
    };
  }
  const item = TUTOR_CHEM_BANK[(level - 1) % TUTOR_CHEM_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: "Physical & Organic Chemistry",
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation
  };
}
var TUTOR_CS_BANK = [
  {
    prompt: "What is the time complexity of Merge Sort on an array of n elements in the worst case?",
    correct: "O(n log n)",
    distractors: ["O(n\xB2)", "O(n)", "O(log n)"],
    explanation: "Merge Sort splits recursively to depth log\u2082 n and merges linearly at every level, guaranteeing O(n log n)."
  },
  {
    prompt: "In database transactions, which ACID property guarantees partial failures roll back completely?",
    correct: "Atomicity",
    distractors: ["Isolation", "Durability", "Sharding"],
    explanation: "Atomicity enforces all-or-nothing execution for multi-step database transactions."
  },
  {
    prompt: "Which graph algorithm finds single-source shortest paths with non-negative edge weights using a min-heap?",
    correct: "Dijkstra's Algorithm",
    distractors: ["Kruskal's MST", "Topological Sort", "Floyd-Warshall only"],
    explanation: "Dijkstra's greedy priority-queue expansion guarantees optimal shortest paths when edge weights are \u2265 0."
  },
  {
    prompt: "Which HTTP method is defined as both safe and idempotent in REST architecture?",
    correct: "GET",
    distractors: ["POST", "PATCH", "CONNECT"],
    explanation: "GET retrieves representations without mutating server state (safe) and produces identical results when repeated."
  },
  {
    prompt: "By the Master Theorem, the recurrence T(n) = 2T(n/2) + \u0398(n) solves to:",
    correct: "\u0398(n log n)",
    distractors: ["\u0398(n)", "\u0398(n\xB2)", "\u0398(log\xB2 n)"],
    explanation: "Case 2 of the Master Theorem applies since f(n) = \u0398(n^(log_2 2)), giving \u0398(n log n)."
  },
  {
    prompt: "Why is Dynamic Programming effective for overlapping subproblems with optimal substructure?",
    correct: "Memoizing/tabulating subproblem answers avoids exponential redundant recomputation",
    distractors: [
      "It converts every NP-hard graph into O(1) lookup",
      "It eliminates base cases in recursion",
      "It sorts inputs before branching"
    ],
    explanation: "Storing solved subproblems reduces exponential recursion trees into polynomial time."
  }
];
function generateTutorCs(level, slotId, rng) {
  if (level % 3 === 0) {
    const depth = randInt(rng, 4, 8);
    const maxNodes = Math.pow(2, depth) - 1;
    const { options: options2, correctIndex: correctIndex2 } = buildOptions(
      String(maxNodes),
      [String(Math.pow(2, depth)), String(Math.pow(2, depth - 1)), String(depth * 2), String(maxNodes - 2)],
      rng
    );
    return {
      id: slotId,
      subject: "Algorithms & Systems",
      prompt: `What is the maximum total number of nodes in a full binary tree of height/levels ${depth} (root at level 1)?`,
      options: options2,
      correctIndex: correctIndex2,
      explanation: `A full binary tree of ${depth} levels holds 2^${depth} \u2212 1 = ${maxNodes} nodes.`
    };
  }
  const item = TUTOR_CS_BANK[(level - 1) % TUTOR_CS_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: "Algorithms & Systems",
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation
  };
}
var TUTOR_CRITICAL_LOGIC_BANK = [
  {
    prompt: 'What is the logical contrapositive of "If a student practices daily, then their confidence grows"?',
    correct: "If confidence does not grow, then the student does not practice daily.",
    distractors: [
      "If confidence grows, then the student practices daily.",
      "If a student does not practice daily, then confidence does not grow.",
      "Confidence grows only when homework is skipped."
    ],
    explanation: "The contrapositive of P \u2192 Q is \xACQ \u2192 \xACP, which is always logically equivalent to P \u2192 Q."
  },
  {
    prompt: 'Arguing "Because mock scores rose right after changing notebooks, the notebook color caused higher scores" commits:',
    correct: "Post hoc ergo propter hoc fallacy",
    distractors: ["Straw man fallacy", "Ad hominem fallacy", "Circular definition"],
    explanation: "Assuming temporal sequence alone proves causation is the classic post hoc fallacy."
  },
  {
    prompt: "In academic writing, which transition introduces a genuine logical concession before a counter-claim?",
    correct: "Admittedly, ...; nevertheless, ...",
    distractors: ["Consequently, ...; therefore, ...", "Identically, ...; thus, ...", "Whereas, ...; hence, ..."],
    explanation: '"Admittedly ...; nevertheless ..." acknowledges an opposing point before pivoting cleanly.'
  },
  {
    prompt: "Which research design best isolates cause and effect when evaluating a new teaching intervention?",
    correct: "Randomized controlled comparison with pre/post diagnostic baselines",
    distractors: [
      "Collecting voluntary testimonials without baseline scores",
      "Measuring only the top 10% of volunteers post-course",
      "Changing three unrelated grading scales mid-term"
    ],
    explanation: "Random assignment + baseline controls eliminate selection bias and confounding factors."
  }
];
function generateTutorCriticalReasoning(level, slotId, rng) {
  const item = TUTOR_CRITICAL_LOGIC_BANK[(level - 1) % TUTOR_CRITICAL_LOGIC_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: "Critical Reasoning & Logic",
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation
  };
}
function generateDailyLevelQuiz(level, track = "student") {
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_DAILY_LEVELS) {
    throw new Error(`Daily level must be an integer between 1 and ${TOTAL_DAILY_LEVELS}.`);
  }
  const normalizedTrack = resolveDailyTrack(track);
  const seed = normalizedTrack === "tutor" ? level * 7919 + 104729 : level * 6271 + 31;
  const rng = createRng(seed);
  const badge = getBadgeForLevel(level, normalizedTrack);
  const tierName = getTierName(level, normalizedTrack);
  const xpReward = (normalizedTrack === "tutor" ? 35 : 25) + Math.floor(level / 25) * 5 + (badge ? 40 : 0);
  let questions;
  let subjectMix;
  if (normalizedTrack === "tutor") {
    const tutorPool = [
      (slotId) => generateTutorAdvancedMath(level, slotId, rng),
      (slotId) => generateTutorAdvancedPhysics(level, slotId, rng),
      (slotId) => generateTutorChemistry(level, slotId, rng),
      (slotId) => generateTutorCs(level, slotId, rng),
      (slotId) => generateTutorCriticalReasoning(level, slotId, rng)
    ];
    const offset2 = level % tutorPool.length;
    const rotated = [...tutorPool.slice(offset2), ...tutorPool.slice(0, offset2)].slice(0, 4);
    questions = [
      generateTutorPedagogy(level, `d_tutor_${level}_q1`, rng),
      ...rotated.map((gen, idx) => gen(`d_tutor_${level}_q${idx + 2}`))
    ];
    subjectMix = Array.from(new Set(questions.map((q) => q.subject))).join(" \xB7 ");
    return {
      level,
      track: "tutor",
      trackLabel: "Tutor Mastery Track",
      tierName,
      title: badge ? `Tutor Level ${level} \xB7 ${badge.name}` : `Tutor Daily Challenge \u2014 Level ${level}`,
      subjectMix,
      passingScore: DAILY_PASSING_SCORE,
      xpReward,
      badge,
      questions
    };
  }
  const studentPool = [
    (slotId) => generateStudentMath(level, slotId, rng),
    (slotId) => generateStudentPhysics(level, slotId, rng),
    (slotId) => generateStudentChemistry(level, slotId, rng),
    (slotId) => generateStudentBiology(level, slotId, rng),
    (slotId) => generateStudentIct(level, slotId, rng),
    (slotId) => generateStudentEnglish(level, slotId, rng),
    (slotId) => generateStudentAnalytical(level, slotId, rng)
  ];
  const offset = level % studentPool.length;
  const pickedGenerators = [
    studentPool[offset],
    studentPool[(offset + 1) % studentPool.length],
    studentPool[(offset + 2) % studentPool.length],
    studentPool[(offset + 4) % studentPool.length],
    studentPool[(offset + 5) % studentPool.length]
  ];
  questions = pickedGenerators.map((gen, idx) => gen(`d_student_${level}_q${idx + 1}`));
  subjectMix = Array.from(new Set(questions.map((q) => q.subject))).join(" \xB7 ");
  return {
    level,
    track: "student",
    trackLabel: "Student Academic Track",
    tierName,
    title: badge ? `Student Level ${level} \xB7 ${badge.name}` : `Student Daily Challenge \u2014 Level ${level}`,
    subjectMix,
    passingScore: DAILY_PASSING_SCORE,
    xpReward,
    badge,
    questions
  };
}

// src/routes/users.ts
var router4 = Router4();
router4.get("/my-profile-summary", verifyToken, async (req, res, next) => {
  try {
    const db = await getDb();
    const user = req.user;
    const track = resolveDailyTrack(user.role);
    const trackBadges = getAllMilestoneBadges(track);
    const todayKey = getDhakaDateKey();
    const prevKey = getPreviousDhakaDateKey(todayKey);
    const [dailyDoc, attempts, tutorTuitions, studentApps] = await Promise.all([
      db.quiz_daily_progress.findOne((p) => p.userId === user._id),
      db.quiz_attempts.find((a) => a.userId === user._id),
      user.role === "tutor" ? db.tuitions.find((t) => t.tutorEmail.toLowerCase() === user.email.toLowerCase()) : Promise.resolve([]),
      user.role === "student" ? db.applications.find((a) => a.studentEmail.toLowerCase() === user.email.toLowerCase()) : Promise.resolve([])
    ]);
    const unlockedSet = new Set(dailyDoc?.unlockedBadgeLevels ?? []);
    const activeStreak = dailyDoc && (dailyDoc.lastCompletedDate === todayKey || dailyDoc.lastCompletedDate === prevKey) ? dailyDoc.streak : 0;
    const badges = trackBadges.map((b) => ({
      ...b,
      unlocked: unlockedSet.has(b.level)
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
        totalBadges: trackBadges.length
      },
      badges,
      recentAttempts: attempts.slice(0, 8),
      roleSummary: user.role === "tutor" ? {
        approvedTuitions: tutorTuitions.filter((t) => t.approvalStatus === "approved" && t.isActive),
        totalTuitionsCount: tutorTuitions.length
      } : user.role === "student" ? {
        applicationsCount: studentApps.length,
        acceptedCount: studentApps.filter((a) => a.status === "accepted").length,
        savedCount: (user.savedTuitionIds || []).length
      } : {}
    });
  } catch (err) {
    next(err);
  }
});
function isSafeHttpUrl(val) {
  const trimmed = val.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
var updateProfileSchema = z4.object({
  name: z4.string().trim().min(2, "Name must be at least 2 characters").max(80),
  phone: z4.string().trim().max(30).optional(),
  bio: z4.string().trim().max(500).optional(),
  image: z4.string().trim().min(1, "Profile image URL is required").refine(isSafeAssetUrl, "Invalid profile image URL."),
  bannerImage: z4.string().trim().optional().refine((val) => !val || isSafeAssetUrl(val), "Invalid banner image URL."),
  facebookUrl: z4.string().trim().max(300).optional().refine((val) => !val || isSafeHttpUrl(val), "Facebook link must start with https:// or http://"),
  youtubeUrl: z4.string().trim().max(300).optional().refine((val) => !val || isSafeHttpUrl(val), "YouTube link must start with https:// or http://")
});
router4.patch("/profile", verifyToken, async (req, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid profile data." });
      return;
    }
    const db = await getDb();
    const updated = await db.users.updateOne(
      (u) => u._id === req.user._id,
      (u) => ({
        ...u,
        name: parsed.data.name,
        phone: parsed.data.phone !== void 0 ? parsed.data.phone : u.phone,
        bio: parsed.data.bio !== void 0 ? parsed.data.bio : u.bio,
        image: parsed.data.image,
        bannerImage: parsed.data.bannerImage !== void 0 ? parsed.data.bannerImage : u.bannerImage || "",
        facebookUrl: parsed.data.facebookUrl !== void 0 ? parsed.data.facebookUrl.trim() : u.facebookUrl || "",
        youtubeUrl: parsed.data.youtubeUrl !== void 0 ? parsed.data.youtubeUrl.trim() : u.youtubeUrl || ""
      })
    );
    if (!updated) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (updated.role === "tutor") {
      await db.tuitions.updateMany(
        (t) => t.tutorEmail.toLowerCase() === updated.email.toLowerCase(),
        (t) => ({
          ...t,
          tutorName: updated.name,
          tutorImage: updated.image
        })
      );
    }
    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});
router4.get("/saved-tuitions", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const db = await getDb();
    const savedIds = req.user.savedTuitionIds || [];
    const items = await db.tuitions.find(
      (t) => savedIds.includes(t._id) && t.approvalStatus === "approved" && t.isActive
    );
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
router4.post("/saved-tuitions/:tuitionId", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const db = await getDb();
    const { tuitionId } = req.params;
    const tuition = await db.tuitions.findOne(
      (t) => t._id === tuitionId && t.approvalStatus === "approved" && t.isActive
    );
    if (!tuition) {
      res.status(404).json({ error: "Tuition not found." });
      return;
    }
    const storedSaved = req.user.savedTuitionIds || [];
    const stillAvailable = new Set(
      (await db.tuitions.find(
        (t) => storedSaved.includes(t._id) && t.approvalStatus === "approved" && t.isActive
      )).map((t) => t._id)
    );
    const currentSaved = storedSaved.filter((id) => stillAvailable.has(id));
    const exists = currentSaved.includes(tuitionId);
    if (!exists && req.user.plan !== "pro" && currentSaved.length >= 5) {
      res.status(403).json({
        error: "Free Student accounts can bookmark up to 5 tuitions. Upgrade to Pro Student for unlimited bookmarks.",
        code: "BOOKMARK_LIMIT_REACHED"
      });
      return;
    }
    const nextSaved = exists ? currentSaved.filter((id) => id !== tuitionId) : [...currentSaved, tuitionId];
    const updated = await db.users.updateOne(
      (u) => u._id === req.user._id,
      (u) => ({
        ...u,
        savedTuitionIds: nextSaved
      })
    );
    res.json({
      saved: !exists,
      savedTuitionIds: updated?.savedTuitionIds || nextSaved
    });
  } catch (err) {
    next(err);
  }
});
var users_default = router4;

// src/routes/payments.ts
import { Router as Router5 } from "express";
import Stripe from "stripe";
import crypto5 from "crypto";
var router5 = Router5();
var pendingTestSessions = /* @__PURE__ */ new Map();
function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.startsWith("sk_test_replace")) return null;
  return new Stripe(key);
}
function getOrigin(req) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : void 0;
  const host = typeof req.headers.host === "string" ? req.headers.host : void 0;
  return getPrimaryAppOrigin(origin, host);
}
function isSandboxPaymentAllowed() {
  if (!isProduction()) return true;
  return process.env.ALLOW_PAYMENT_SANDBOX === "true";
}
async function fulfillProUpgrade(params) {
  const db = await getDb();
  const existingPayment = await db.payments.findOne(
    (p) => p.stripeSessionId === params.stripeSessionId || p.transactionId === params.transactionId
  );
  if (existingPayment) {
    const user = await db.users.findOne(
      (u) => u.email.toLowerCase() === params.userEmail.toLowerCase()
    );
    return {
      payment: existingPayment,
      user: user ? sanitizeUser(user) : null,
      alreadyProcessed: true
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
      paymentStatus: "paid",
      paidAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const raced = await db.payments.findByField("stripeSessionId", params.stripeSessionId);
    const racedUser = await db.users.findByField("email", params.userEmail.toLowerCase());
    if (!raced) throw err;
    return {
      payment: raced,
      user: racedUser ? sanitizeUser(racedUser) : null,
      alreadyProcessed: true
    };
  }
  const updatedUser = await db.users.updateOne(
    (u) => u.email.toLowerCase() === params.userEmail.toLowerCase(),
    (u) => ({
      ...u,
      plan: "pro"
    })
  );
  if (updatedUser?.role === "tutor") {
    await db.tuitions.updateMany(
      (t) => t.tutorEmail.toLowerCase() === updatedUser.email.toLowerCase(),
      (t) => ({ ...t, tutorPlan: "pro" })
    );
  }
  return {
    payment,
    user: updatedUser ? sanitizeUser(updatedUser) : null,
    alreadyProcessed: false
  };
}
router5.post(
  "/create-checkout-session",
  verifyToken,
  paymentRateLimiter,
  async (req, res, next) => {
    try {
      const db = await getDb();
      const user = await db.users.findOne((u) => u._id === req.user._id);
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      if (user.role === "admin") {
        res.status(400).json({ error: "Pro plans apply to Student and Tutor accounts only." });
        return;
      }
      if (user.plan === "pro") {
        res.status(400).json({ error: "Your account is already on a Pro plan." });
        return;
      }
      const isTutor = user.role === "tutor";
      const amount = isTutor ? 15 : 10;
      const planName = isTutor ? "Pro Tutor" : "Pro Student";
      const origin = getOrigin(req);
      const stripe = getStripeClient();
      if (stripe) {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          customer_email: user.email,
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `MentorLagbe ${planName} Plan`,
                  description: isTutor ? "Unlimited tuition listings and Pro Tutor badge." : "Unlimited bookmarked tuitions and Pro Student badge."
                },
                unit_amount: Math.round(amount * 100)
              },
              quantity: 1
            }
          ],
          metadata: {
            userId: user._id,
            userEmail: user.email,
            userName: user.name,
            userRole: user.role,
            planName,
            amount: String(amount)
          },
          success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/payment/cancel`
        });
        res.json({
          checkoutUrl: session.url,
          sessionId: session.id,
          mode: "stripe_live",
          amount
        });
        return;
      }
      if (!isSandboxPaymentAllowed()) {
        res.status(503).json({
          error: "Stripe checkout is not configured on this server."
        });
        return;
      }
      const sessionId = `cs_test_${crypto5.randomBytes(16).toString("hex")}`;
      pendingTestSessions.set(sessionId, {
        sessionId,
        userId: user._id,
        userEmail: user.email,
        userName: user.name,
        userRole: user.role,
        planName,
        amount,
        createdAt: Date.now()
      });
      res.json({
        checkoutUrl: `${origin}/payment/stripe-checkout?session_id=${encodeURIComponent(sessionId)}`,
        sessionId,
        mode: "stripe_sandbox",
        amount
      });
    } catch (err) {
      next(err);
    }
  }
);
router5.get("/session-preview/:sessionId", verifyToken, (req, res) => {
  const session = pendingTestSessions.get(req.params.sessionId);
  if (!session || session.userId !== req.user._id) {
    res.status(404).json({ error: "Checkout session not found or expired." });
    return;
  }
  res.json({ session });
});
router5.post("/verify-session", verifyToken, async (req, res, next) => {
  try {
    const sessionId = typeof req.body.sessionId === "string" ? req.body.sessionId.trim() : "";
    if (!sessionId) {
      res.status(400).json({ error: "Stripe session ID is required." });
      return;
    }
    const db = await getDb();
    const existing = await db.payments.findOne((p) => p.stripeSessionId === sessionId);
    if (existing) {
      const user = await db.users.findOne(
        (u) => u.email.toLowerCase() === existing.userEmail.toLowerCase()
      );
      res.json({
        verified: true,
        payment: existing,
        user: user ? sanitizeUser(user) : req.user
      });
      return;
    }
    const stripe = getStripeClient();
    if (stripe && !pendingTestSessions.has(sessionId)) {
      let session;
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
      } catch (stripeErr) {
        if (stripeErr instanceof Stripe.errors.StripeInvalidRequestError) {
          res.status(400).json({ error: "Invalid checkout session." });
          return;
        }
        throw stripeErr;
      }
      if (session.payment_status !== "paid") {
        res.status(400).json({ error: "Payment has not been completed yet." });
        return;
      }
      const metaEmail = session.metadata?.userEmail || session.customer_email || req.user.email;
      if (metaEmail.toLowerCase() !== req.user.email.toLowerCase()) {
        res.status(403).json({ error: "Unauthorized payment session verification." });
        return;
      }
      const amount = Number(
        session.amount_total ? session.amount_total / 100 : session.metadata?.amount || 10
      );
      const planName = session.metadata?.planName || (req.user.role === "tutor" ? "Pro Tutor" : "Pro Student");
      const transactionId2 = typeof session.payment_intent === "string" ? session.payment_intent : `pi_${crypto5.randomBytes(10).toString("hex")}`;
      const result2 = await fulfillProUpgrade({
        userEmail: req.user.email,
        userName: req.user.name,
        userRole: req.user.role,
        planName,
        amount,
        currency: (session.currency || "usd").toUpperCase(),
        stripeSessionId: session.id,
        transactionId: transactionId2
      });
      res.json({ verified: true, ...result2 });
      return;
    }
    if (!isSandboxPaymentAllowed()) {
      res.status(503).json({ error: "Sandbox payment verification is disabled in production." });
      return;
    }
    const pending = pendingTestSessions.get(sessionId);
    if (!pending || pending.userId !== req.user._id) {
      res.status(404).json({ error: "Payment session could not be verified." });
      return;
    }
    const transactionId = `pi_test_${crypto5.randomBytes(10).toString("hex")}`;
    const result = await fulfillProUpgrade({
      userEmail: pending.userEmail,
      userName: pending.userName,
      userRole: pending.userRole,
      planName: pending.planName,
      amount: pending.amount,
      currency: "USD",
      stripeSessionId: pending.sessionId,
      transactionId
    });
    pendingTestSessions.delete(sessionId);
    res.json({ verified: true, ...result });
  } catch (err) {
    next(err);
  }
});
async function stripeWebhookHandler(req, res) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const sig = req.headers["stripe-signature"];
  if (!stripe || !webhookSecret || typeof sig !== "string") {
    res.status(400).json({ error: "Stripe webhook signature configuration missing." });
    return;
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    res.status(400).json({ error: `Webhook verification failed: ${err.message}` });
    return;
  }
  try {
    await handleStripeEvent(event);
  } catch (err) {
    console.error("[Stripe webhook] Failed to process event", event.id, err);
    res.status(500).json({ error: "Webhook processing failed." });
    return;
  }
  res.json({ received: true });
}
async function handleStripeEvent(event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      const userEmail = session.metadata?.userEmail || session.customer_email || "";
      const userName = session.metadata?.userName || "MentorLagbe Member";
      const userRole = session.metadata?.userRole || "student";
      const planName = session.metadata?.planName || "Pro Plan";
      const amount = Number(
        session.amount_total ? session.amount_total / 100 : session.metadata?.amount || 10
      );
      const transactionId = typeof session.payment_intent === "string" ? session.payment_intent : `pi_${crypto5.randomBytes(10).toString("hex")}`;
      if (userEmail) {
        await fulfillProUpgrade({
          userEmail,
          userName,
          userRole,
          planName,
          amount,
          currency: (session.currency || "usd").toUpperCase(),
          stripeSessionId: session.id,
          transactionId
        });
      }
    }
  }
}
router5.get("/my", verifyToken, async (req, res, next) => {
  try {
    const db = await getDb();
    const items = await db.payments.find(
      (p) => p.userEmail.toLowerCase() === req.user.email.toLowerCase()
    );
    items.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
var payments_default = router5;

// src/routes/admin.ts
import { Router as Router6 } from "express";
import { z as z5 } from "zod";
var router6 = Router6();
router6.use(verifyToken, verifyAdmin);
var updateRoleSchema = z5.object({
  role: z5.enum(["student", "tutor", "admin"])
});
var updateTuitionModerationSchema = z5.object({
  approvalStatus: z5.enum(["pending", "approved", "rejected"]).optional(),
  isActive: z5.boolean().optional(),
  rejectionReason: z5.string().trim().max(400).optional()
});
router6.get("/overview", async (_req, res, next) => {
  try {
    const db = await getDb();
    const [users, tuitions, payments, applications, customQuizzes] = await Promise.all([
      db.users.findAll(),
      db.tuitions.findAll(),
      db.payments.findAll(),
      db.applications.findAll(),
      db.custom_quizzes.findAll()
    ]);
    const totalUsers = users.length;
    const totalStudents = users.filter((u) => u.role === "student").length;
    const totalTutors = users.filter((u) => u.role === "tutor").length;
    const pendingTuitions = tuitions.filter((t) => t.approvalStatus === "pending").length;
    const approvedTuitions = tuitions.filter((t) => t.approvalStatus === "approved").length;
    const pendingQuizzes = customQuizzes.filter((q) => q.approvalStatus === "pending").length;
    const totalRevenue = payments.filter((p) => p.paymentStatus === "paid").reduce((sum, p) => sum + p.amount, 0);
    const recentPayments = [...payments].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()).slice(0, 5);
    res.json({
      totalUsers,
      totalStudents,
      totalTutors,
      pendingTuitions,
      approvedTuitions,
      pendingQuizzes,
      totalApplications: applications.length,
      totalRevenue,
      recentPayments
    });
  } catch (err) {
    next(err);
  }
});
router6.get("/users", async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const role = typeof req.query.role === "string" ? req.query.role.trim() : "";
    let users = await db.users.findAll();
    if (search) {
      users = users.filter(
        (u) => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search)
      );
    }
    if (role && role !== "all") {
      users = users.filter((u) => u.role === role);
    }
    users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: users.map(sanitizeUser) });
  } catch (err) {
    next(err);
  }
});
router6.patch("/users/:id/role", async (req, res, next) => {
  try {
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Role must be student, tutor, or admin." });
      return;
    }
    if (req.params.id === req.user._id && parsed.data.role !== "admin") {
      res.status(400).json({ error: "You cannot revoke your own admin privileges." });
      return;
    }
    const db = await getDb();
    const updated = await db.users.updateOne(
      (u) => u._id === req.params.id,
      (u) => ({ ...u, role: parsed.data.role })
    );
    if (!updated) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});
router6.delete("/users/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.user._id) {
      res.status(400).json({ error: "You cannot delete your own admin account." });
      return;
    }
    const db = await getDb();
    const target = await db.users.findOne((u) => u._id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (target.role === "admin") {
      res.status(403).json({ error: "Admin accounts cannot be deleted here." });
      return;
    }
    await db.users.deleteOne((u) => u._id === target._id);
    await db.auth_sessions.deleteMany((s) => s.userId === target._id);
    await Promise.all([
      db.messages.deleteMany((m) => m.senderId === target._id || m.recipientId === target._id),
      db.notifications.deleteMany((n) => n.userEmail.toLowerCase() === target.email.toLowerCase()),
      db.quiz_attempts.deleteMany((a) => a.userId === target._id),
      db.quiz_daily_progress.deleteMany((p) => p.userId === target._id),
      db.tutor_requests.deleteMany((r) => r.studentId === target._id)
    ]);
    if (target.role === "tutor") {
      await db.tuitions.deleteMany((t) => t.tutorEmail.toLowerCase() === target.email.toLowerCase());
      await db.applications.deleteMany(
        (a) => a.tutorEmail.toLowerCase() === target.email.toLowerCase()
      );
    } else if (target.role === "student") {
      await db.applications.deleteMany(
        (a) => a.studentEmail.toLowerCase() === target.email.toLowerCase()
      );
    }
    res.json({ message: "User account removed." });
  } catch (err) {
    next(err);
  }
});
router6.get("/tuitions", async (req, res, next) => {
  try {
    const db = await getDb();
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    let tuitions = await db.tuitions.findAll();
    if (status && status !== "all") {
      tuitions = tuitions.filter((t) => t.approvalStatus === status);
    }
    tuitions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: tuitions });
  } catch (err) {
    next(err);
  }
});
router6.patch("/tuitions/:id", async (req, res, next) => {
  try {
    const parsed = updateTuitionModerationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid moderation payload." });
      return;
    }
    const db = await getDb();
    const existing = await db.tuitions.findOne((t) => t._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Tuition listing not found." });
      return;
    }
    const updated = await db.tuitions.updateOne(
      (t) => t._id === req.params.id,
      (t) => ({
        ...t,
        ...parsed.data.approvalStatus ? { approvalStatus: parsed.data.approvalStatus } : {},
        ...typeof parsed.data.isActive === "boolean" ? { isActive: parsed.data.isActive, adminDisabled: parsed.data.isActive === false } : {},
        ...typeof parsed.data.rejectionReason === "string" ? { rejectionReason: parsed.data.rejectionReason } : {}
      })
    );
    if (parsed.data.approvalStatus && parsed.data.approvalStatus !== existing.approvalStatus) {
      await createNotification(db, {
        userEmail: existing.tutorEmail,
        title: `Tuition ${parsed.data.approvalStatus}`,
        message: parsed.data.approvalStatus === "approved" ? `"${existing.title}" has been approved and is now live.` : `"${existing.title}" was marked ${parsed.data.approvalStatus}.`,
        type: "moderation",
        link: "/dashboard/tutor/my-tuitions"
      });
    }
    res.json({ tuition: updated });
  } catch (err) {
    next(err);
  }
});
router6.get("/transactions", async (_req, res, next) => {
  try {
    const db = await getDb();
    const items = await db.payments.findAll();
    items.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
var admin_default = router6;

// src/routes/upload.ts
import { Router as Router7 } from "express";
import fs2 from "fs";
import path2 from "path";
import crypto6 from "crypto";
import { fileURLToPath as fileURLToPath2 } from "url";
var router7 = Router7();
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path2.dirname(__filename2);
var UPLOAD_DIR = path2.resolve(__dirname2, "..", "..", "uploads");
function hasDangerousExtension(filename) {
  const lower = filename.trim().toLowerCase();
  return /\.(svg|html|htm|js|mjs|cjs|ts|php|exe|sh|bat|cmd)$/i.test(lower);
}
function matchesImageSignature(buffer, ext) {
  if (ext === "png") return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === "jpg" || ext === "jpeg") return buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (ext === "gif") return buffer.length > 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  if (ext === "webp") return buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
router7.post("/", verifyToken, uploadRateLimiter, async (req, res, next) => {
  try {
    const { imageBase64, filename } = req.body;
    if (!imageBase64 || typeof imageBase64 !== "string") {
      res.status(400).json({ error: "No image data provided." });
      return;
    }
    if (filename && typeof filename === "string" && hasDangerousExtension(filename)) {
      res.status(400).json({ error: "Executable, HTML, SVG, or script files are not allowed." });
      return;
    }
    const match = imageBase64.match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: "Unsupported image format. Please upload PNG, JPG, WEBP, or GIF." });
      return;
    }
    const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
    const rawBase64 = match[3];
    const buffer = Buffer.from(rawBase64, "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "Uploaded image file is empty." });
      return;
    }
    if (!matchesImageSignature(buffer, ext)) {
      res.status(400).json({ error: "The file content does not match the declared image type." });
      return;
    }
    if (buffer.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: "Image size must be under 5MB." });
      return;
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const cloudKey = process.env.CLOUDINARY_API_KEY?.trim();
    const cloudSecret = process.env.CLOUDINARY_API_SECRET?.trim();
    if (cloudName && cloudKey && cloudSecret && !cloudName.startsWith("replace_with")) {
      const folder = "mentorlagbe";
      const timestamp = Math.floor(Date.now() / 1e3).toString();
      const signature = crypto6.createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${cloudSecret}`).digest("hex");
      const form = new FormData();
      form.append("file", `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${rawBase64}`);
      form.append("api_key", cloudKey);
      form.append("timestamp", timestamp);
      form.append("folder", folder);
      form.append("signature", signature);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
        method: "POST",
        body: form
      });
      const json = await response.json();
      if (response.ok && json.secure_url) {
        res.json({ url: json.secure_url, provider: "cloudinary" });
        return;
      }
      throw new Error(json.error?.message || "Cloudinary upload failed.");
    }
    const imgbbKey = process.env.IMGBB_API_KEY?.trim();
    if (imgbbKey && !imgbbKey.startsWith("replace_with")) {
      const form = new FormData();
      form.append("key", imgbbKey);
      form.append("image", rawBase64);
      if (filename) form.append("name", filename.replace(/[^a-zA-Z0-9._-]/g, "_"));
      const response = await fetch("https://api.imgbb.com/1/upload", {
        method: "POST",
        body: form
      });
      const json = await response.json();
      if (response.ok && json.success && (json.data?.display_url || json.data?.url)) {
        res.json({ url: json.data.display_url || json.data.url, provider: "imgbb" });
        return;
      }
      throw new Error(json.error?.message || "ImgBB upload failed.");
    }
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({
        error: "Image upload is not configured. Set IMGBB_API_KEY (or the CLOUDINARY_* variables) on the server."
      });
      return;
    }
    if (!fs2.existsSync(UPLOAD_DIR)) {
      fs2.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    const safeName = `${Date.now()}_${crypto6.randomBytes(6).toString("hex")}.${ext}`;
    fs2.writeFileSync(path2.join(UPLOAD_DIR, safeName), buffer);
    res.json({
      url: `/api/uploads/${safeName}`,
      provider: "local"
    });
  } catch (err) {
    next(err);
  }
});
var upload_default = router7;

// src/routes/tutors.ts
import { Router as Router8 } from "express";
var router8 = Router8();
router8.get("/", async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
    const mode = typeof req.query.mode === "string" ? req.query.mode.trim() : "";
    const plan = typeof req.query.plan === "string" ? req.query.plan.trim() : "";
    const [tutors, approvedTuitions] = await Promise.all([
      db.users.find((u) => u.role === "tutor"),
      db.tuitions.find((t) => t.approvalStatus === "approved" && t.isActive === true)
    ]);
    const tuitionsByEmail = /* @__PURE__ */ new Map();
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
      const avgRating = allReviews.length > 0 ? Number(
        (allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length).toFixed(1)
      ) : null;
      const minMonthlyFee = batches.length > 0 ? Math.min(...batches.map((b) => b.monthlyFee)) : null;
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
        createdAt: tutor.createdAt
      };
    });
    if (search) {
      items = items.filter(
        (t) => t.name.toLowerCase().includes(search) || t.bio.toLowerCase().includes(search) || t.subjects.some((s) => s.toLowerCase().includes(search)) || t.locations.some((l) => l.toLowerCase().includes(search))
      );
    }
    if (subject && subject !== "All") {
      items = items.filter(
        (t) => t.subjects.some((s) => s.toLowerCase() === subject.toLowerCase())
      );
    }
    if (mode && mode !== "All") {
      items = items.filter((t) => t.modes.some((m) => m.toLowerCase() === mode.toLowerCase()));
    }
    if (plan === "pro") {
      items = items.filter((t) => t.plan === "pro");
    }
    items.sort((a, b) => {
      if (a.plan !== b.plan) return a.plan === "pro" ? -1 : 1;
      return b.tuitionCount - a.tuitionCount;
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
router8.get("/:id", async (req, res, next) => {
  try {
    const db = await getDb();
    const tutor = await db.users.findOne((u) => u._id === req.params.id && u.role === "tutor");
    if (!tutor) {
      res.status(404).json({ error: "Tutor profile not found." });
      return;
    }
    const [tuitions, dailyDoc] = await Promise.all([
      db.tuitions.find(
        (t) => t.tutorEmail.toLowerCase() === tutor.email.toLowerCase() && t.approvalStatus === "approved" && t.isActive === true
      ),
      db.quiz_daily_progress.findOne((p) => p.userId === tutor._id)
    ]);
    tuitions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const reviews = tuitions.flatMap(
      (t) => (t.reviews || []).map((r) => ({
        _id: r._id,
        studentName: r.studentName,
        rating: r.rating,
        comment: r.comment,
        tuitionTitle: t.title,
        createdAt: r.createdAt
      }))
    );
    const avgRating = reviews.length > 0 ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)) : null;
    const tutorTrackBadges = getAllMilestoneBadges("tutor");
    const unlockedSet = new Set(dailyDoc?.unlockedBadgeLevels ?? []);
    const earnedBadges = tutorTrackBadges.filter((b) => unlockedSet.has(b.level)).map((b) => ({
      ...b,
      unlocked: true
    }));
    res.json({
      tutor: {
        _id: tutor._id,
        name: tutor.name,
        image: tutor.image,
        bannerImage: tutor.bannerImage || "",
        facebookUrl: tutor.facebookUrl || "",
        youtubeUrl: tutor.youtubeUrl || "",
        bio: tutor.bio,
        plan: tutor.plan,
        subjects: Array.from(new Set(tuitions.map((t) => t.subject))),
        modes: Array.from(new Set(tuitions.map((t) => t.mode))),
        avgRating,
        reviewCount: reviews.length,
        tuitionCount: tuitions.length,
        createdAt: tutor.createdAt,
        dailyStats: {
          track: "tutor",
          completedLevel: dailyDoc?.completedLevel ?? 0,
          streak: dailyDoc?.streak ?? 0,
          totalXp: dailyDoc?.totalXp ?? 0,
          unlockedCount: earnedBadges.length,
          totalLevels: TOTAL_DAILY_LEVELS,
          totalBadges: tutorTrackBadges.length
        },
        earnedBadges
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
          createdAt: r.createdAt
        }))
      })),
      reviews
    });
  } catch (err) {
    next(err);
  }
});
var tutors_default = router8;

// src/routes/resources.ts
import { Router as Router9 } from "express";
import { z as z6 } from "zod";

// src/utils/atomic.ts
async function adjustCoins(db, userId, delta) {
  return db.users.inc(userId, "coins", delta, delta < 0 ? { min: 0 } : void 0);
}

// src/routes/resources.ts
var router9 = Router9();
function isSafeResourceLink(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
var createResourceSchema = z6.object({
  title: z6.string().trim().min(5, "Title must be at least 5 characters").max(140),
  category: z6.enum(["Formula Sheets", "Lecture Notes", "Exam Guides", "Coding Labs", "Past Papers"]),
  subject: z6.string().trim().min(2, "Subject is required").max(60),
  classLevel: z6.string().trim().min(2, "Class level is required").max(60),
  summary: z6.string().trim().min(15, "Summary must be at least 15 characters").max(320),
  contentPreview: z6.string().trim().min(20, "Preview notes must be at least 20 characters").max(2e3),
  thumbnailUrl: z6.string().trim().min(1).refine(isSafeAssetUrl, "Invalid thumbnail image URL."),
  resourceUrl: z6.string().trim().min(1).refine(isSafeResourceLink, "Invalid resource link."),
  accessLevel: z6.enum(["free", "pro"]).default("free")
});
router9.get("/", optionalAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const hasProAccess = Boolean(req.user && (req.user.plan === "pro" || req.user.role === "admin"));
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
    const access = typeof req.query.access === "string" ? req.query.access.trim() : "";
    let items = await db.resources.find((r) => r.approvalStatus === "approved");
    if (search) {
      items = items.filter(
        (r) => r.title.toLowerCase().includes(search) || r.subject.toLowerCase().includes(search) || r.summary.toLowerCase().includes(search) || r.authorName.toLowerCase().includes(search)
      );
    }
    if (category && category !== "All") {
      items = items.filter((r) => r.category.toLowerCase() === category.toLowerCase());
    }
    if (subject && subject !== "All") {
      items = items.filter((r) => r.subject.toLowerCase() === subject.toLowerCase());
    }
    if (access === "free" || access === "pro") {
      items = items.filter((r) => r.accessLevel === access);
    }
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({
      items: items.map(({ authorEmail: _omit, downloaderIds: _dl, ...safe }) => {
        if (safe.accessLevel === "pro" && !hasProAccess) {
          const { resourceUrl: _hidden, ...withoutLink } = safe;
          return withoutLink;
        }
        return safe;
      })
    });
  } catch (err) {
    next(err);
  }
});
router9.get("/mine", verifyToken, async (req, res, next) => {
  try {
    if (req.user.role !== "tutor" && req.user.role !== "admin") {
      res.status(403).json({ error: "Only Tutors and Admins manage study resources." });
      return;
    }
    const db = await getDb();
    const items = await db.resources.find(
      (r) => r.authorEmail.toLowerCase() === req.user.email.toLowerCase()
    );
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: items.map(({ downloaderIds: _dl, ...safe }) => safe) });
  } catch (err) {
    next(err);
  }
});
router9.post("/", verifyToken, async (req, res, next) => {
  try {
    if (req.user.role !== "tutor" && req.user.role !== "admin") {
      res.status(403).json({ error: "Only Tutors and Admins can publish study resources." });
      return;
    }
    const parsed = createResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid resource data." });
      return;
    }
    const db = await getDb();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1e3;
    const recentOwn = await db.resources.count(
      (r) => r.authorId === req.user._id && new Date(r.createdAt).getTime() >= dayAgo
    );
    const autoApprove = req.user.role === "admin" || req.user.plan === "pro" && recentOwn < 3;
    const created = await db.resources.insertOne({
      _id: `res_${generateId()}`,
      ...parsed.data,
      authorId: req.user._id,
      authorName: req.user.name,
      authorEmail: req.user.email,
      approvalStatus: autoApprove ? "approved" : "pending",
      approvalCoinCredited: autoApprove,
      downloads: 0,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (autoApprove) {
      await adjustCoins(db, req.user._id, 25);
    }
    res.status(201).json({ resource: created });
  } catch (err) {
    next(err);
  }
});
router9.post("/:id/download", optionalAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const resource = await db.resources.findOne(
      (r) => r._id === req.params.id && r.approvalStatus === "approved"
    );
    if (!resource) {
      res.status(404).json({ error: "Study resource not found." });
      return;
    }
    if (resource.accessLevel === "pro") {
      if (!req.user) {
        res.status(401).json({ error: "Sign in with a Pro plan to unlock Pro study packs." });
        return;
      }
      if (req.user.plan !== "pro" && req.user.role !== "admin") {
        res.status(403).json({
          error: "Upgrade to Pro to download Pro study packs.",
          code: "PRO_PLAN_REQUIRED"
        });
        return;
      }
    }
    if (req.user) {
      const firstDownload = await db.resources.claimOnce(resource._id, "downloaderIds", req.user._id);
      if (firstDownload) {
        await db.resources.inc(resource._id, "downloads", 1);
        if (req.user._id !== resource.authorId) {
          await adjustCoins(db, resource.authorId, 5);
        }
      }
    }
    const updated = await db.resources.findById(resource._id);
    res.json({
      downloads: updated?.downloads ?? resource.downloads + 1,
      resourceUrl: resource.resourceUrl
    });
  } catch (err) {
    next(err);
  }
});
router9.get("/admin/all", verifyToken, verifyAdmin, async (_req, res, next) => {
  try {
    const db = await getDb();
    const items = await db.resources.findAll();
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
router9.patch("/:id/moderation", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const schema = z6.object({ approvalStatus: z6.enum(["pending", "approved", "rejected"]) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid approval status." });
      return;
    }
    const db = await getDb();
    const existing = await db.resources.findOne((r) => r._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Resource not found." });
      return;
    }
    const shouldCreditApprovalCoin = parsed.data.approvalStatus === "approved" && !existing.approvalCoinCredited;
    let updated;
    let creditNow = false;
    if (shouldCreditApprovalCoin) {
      creditNow = await db.resources.replaceIfUnchanged(
        existing._id,
        { approvalCoinCredited: existing.approvalCoinCredited },
        { ...existing, approvalStatus: parsed.data.approvalStatus, approvalCoinCredited: true }
      );
      updated = await db.resources.findById(existing._id);
    } else {
      updated = await db.resources.updateOne(
        (r) => r._id === req.params.id,
        (r) => ({ ...r, approvalStatus: parsed.data.approvalStatus })
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
router9.delete("/:id", verifyToken, async (req, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.resources.findOne((r) => r._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Resource not found." });
      return;
    }
    const isOwner = existing.authorEmail.toLowerCase() === req.user.email.toLowerCase();
    if (!isOwner && req.user.role !== "admin") {
      res.status(403).json({ error: "You cannot delete another author\u2019s resource." });
      return;
    }
    await db.resources.deleteOne((r) => r._id === existing._id);
    res.json({ message: "Resource deleted." });
  } catch (err) {
    next(err);
  }
});
var resources_default = router9;

// src/routes/tutorRequests.ts
import { Router as Router10 } from "express";
import { z as z7 } from "zod";
var router10 = Router10();
var createRequestSchema = z7.object({
  title: z7.string().trim().min(5, "Title must be at least 5 characters").max(140),
  subject: z7.string().trim().min(2).max(60),
  classLevel: z7.string().trim().min(2).max(60),
  mode: z7.enum(["Online", "Offline"]),
  location: z7.string().trim().min(2).max(100),
  budgetMonthly: z7.coerce.number().min(500).max(1e5),
  daysPerWeek: z7.coerce.number().int().min(1).max(7),
  scheduleNote: z7.string().trim().min(3).max(160),
  description: z7.string().trim().min(15, "Description must be at least 15 characters").max(1e3)
});
var respondSchema = z7.object({
  proposedFee: z7.coerce.number().min(500).max(1e5),
  pitch: z7.string().trim().min(10, "Write a brief teaching proposal").max(600)
});
router10.get("/", async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
    const mode = typeof req.query.mode === "string" ? req.query.mode.trim() : "";
    let items = await db.tutor_requests.find((r) => r.status === "open");
    if (search) {
      items = items.filter(
        (r) => r.title.toLowerCase().includes(search) || r.subject.toLowerCase().includes(search) || r.location.toLowerCase().includes(search) || r.description.toLowerCase().includes(search)
      );
    }
    if (subject && subject !== "All") {
      items = items.filter((r) => r.subject.toLowerCase() === subject.toLowerCase());
    }
    if (mode && mode !== "All") {
      items = items.filter((r) => r.mode.toLowerCase() === mode.toLowerCase());
    }
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({
      // Tutor pitches and fees are private between the tutor and the student who asked.
      items: items.map(({ studentEmail: _omit, responses, ...safe }) => ({
        ...safe,
        responsesCount: responses.length
      }))
    });
  } catch (err) {
    next(err);
  }
});
router10.get("/mine", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const db = await getDb();
    const items = await db.tutor_requests.find(
      (r) => r.studentEmail.toLowerCase() === req.user.email.toLowerCase()
    );
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
router10.post("/", verifyToken, verifyStudent, async (req, res, next) => {
  try {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid tutor request." });
      return;
    }
    const db = await getDb();
    const created = await db.tutor_requests.insertOne({
      _id: `treq_${generateId()}`,
      studentId: req.user._id,
      studentName: req.user.name,
      studentEmail: req.user.email,
      ...parsed.data,
      status: "open",
      responses: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.status(201).json({ request: created });
  } catch (err) {
    next(err);
  }
});
router10.post("/:id/respond", verifyToken, verifyTutor, async (req, res, next) => {
  try {
    const parsed = respondSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid response payload." });
      return;
    }
    const db = await getDb();
    const target = await db.tutor_requests.findOne((r) => r._id === req.params.id);
    if (!target || target.status !== "open") {
      res.status(404).json({ error: "This tutor request is no longer open." });
      return;
    }
    if (target.responses.some((resp) => resp.tutorId === req.user._id)) {
      res.status(409).json({ error: "You have already responded to this tutor request." });
      return;
    }
    const newResponse = {
      _id: `tresp_${generateId()}`,
      tutorId: req.user._id,
      tutorName: req.user.name,
      tutorImage: req.user.image,
      tutorPlan: req.user.plan,
      proposedFee: parsed.data.proposedFee,
      pitch: parsed.data.pitch,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const updated = await db.tutor_requests.updateOne(
      (r) => r._id === target._id,
      (r) => ({ ...r, responses: [...r.responses, newResponse] })
    );
    await createNotification(db, {
      userEmail: target.studentEmail,
      title: "New tutor response to your request",
      message: `${req.user.name} responded to "${target.title}".`,
      type: "request",
      link: "/dashboard/student/tutor-requests"
    });
    res.status(201).json({ request: updated });
  } catch (err) {
    next(err);
  }
});
router10.patch("/:id/status", verifyToken, async (req, res, next) => {
  try {
    const schema = z7.object({ status: z7.enum(["open", "matched", "closed"]) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid status." });
      return;
    }
    const db = await getDb();
    const existing = await db.tutor_requests.findOne((r) => r._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Tutor request not found." });
      return;
    }
    const isOwner = existing.studentEmail.toLowerCase() === req.user.email.toLowerCase();
    if (!isOwner && req.user.role !== "admin") {
      res.status(403).json({ error: "You cannot modify another student\u2019s tutor request." });
      return;
    }
    const updated = await db.tutor_requests.updateOne(
      (r) => r._id === existing._id,
      (r) => ({ ...r, status: parsed.data.status })
    );
    res.json({ request: updated });
  } catch (err) {
    next(err);
  }
});
var tutorRequests_default = router10;

// src/routes/messages.ts
import { Router as Router11 } from "express";
import { z as z8 } from "zod";
var router11 = Router11();
router11.use(verifyToken);
var sendMessageSchema = z8.object({
  body: z8.string().trim().min(1, "Message cannot be empty").max(1e3)
});
router11.get("/threads", async (req, res, next) => {
  try {
    const db = await getDb();
    const myId = req.user._id;
    const allMessages = await db.messages.find(
      (m) => m.senderId === myId || m.recipientId === myId
    );
    allMessages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const threadMap = /* @__PURE__ */ new Map();
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
          unreadCount: isUnread ? 1 : 0
        });
      } else if (isUnread) {
        existing.unreadCount += 1;
      }
    }
    const me = req.user;
    const users = await db.users.find(
      (u) => u._id !== myId && u.role !== "admin" && (me.role === "admin" || (me.role === "student" ? u.role === "tutor" : u.role === "student"))
    );
    const contacts = users.slice(0, 300).map((u) => ({
      _id: u._id,
      name: u.name,
      role: u.role,
      image: u.image,
      plan: u.plan
    }));
    res.json({
      threads: Array.from(threadMap.values()),
      contacts
    });
  } catch (err) {
    next(err);
  }
});
router11.get("/thread/:partnerId", async (req, res, next) => {
  try {
    const db = await getDb();
    const myId = req.user._id;
    const partnerId = req.params.partnerId;
    const partner = await db.users.findOne((u) => u._id === partnerId);
    if (!partner) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    await db.messages.updateMany(
      (m) => m.senderId === partnerId && m.recipientId === myId && !m.read,
      (m) => ({ ...m, read: true })
    );
    const messages = await db.messages.find(
      (m) => m.senderId === myId && m.recipientId === partnerId || m.senderId === partnerId && m.recipientId === myId
    );
    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    res.json({
      partner: {
        _id: partner._id,
        name: partner.name,
        role: partner.role,
        image: partner.image,
        plan: partner.plan
      },
      messages
    });
  } catch (err) {
    next(err);
  }
});
router11.post("/thread/:partnerId", async (req, res, next) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Message body required." });
      return;
    }
    const myId = req.user._id;
    const partnerId = req.params.partnerId;
    if (partnerId === myId) {
      res.status(400).json({ error: "You cannot send messages to yourself." });
      return;
    }
    const db = await getDb();
    const partner = await db.users.findOne((u) => u._id === partnerId);
    if (!partner) {
      res.status(404).json({ error: "Recipient not found." });
      return;
    }
    const me = req.user;
    const isOppositeRole = me.role === "student" && partner.role === "tutor" || me.role === "tutor" && partner.role === "student";
    const hasMessagedMeFirst = await db.messages.findOne(
      (m) => m.senderId === partner._id && m.recipientId === me._id
    );
    if (me.role !== "admin" && !isOppositeRole && !hasMessagedMeFirst) {
      res.status(403).json({
        error: "You can only message tutors (as a student) or students (as a tutor), or reply to someone who wrote to you."
      });
      return;
    }
    const created = await db.messages.insertOne({
      _id: `msg_${generateId()}`,
      senderId: req.user._id,
      senderName: req.user.name,
      senderRole: req.user.role,
      senderImage: req.user.image,
      recipientId: partner._id,
      recipientName: partner.name,
      recipientRole: partner.role,
      recipientImage: partner.image,
      body: parsed.data.body,
      read: false,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    await createNotification(db, {
      userEmail: partner.email,
      title: `New message from ${req.user.name}`,
      message: parsed.data.body.slice(0, 110),
      type: "message",
      link: `/dashboard/messages?partner=${encodeURIComponent(req.user._id)}`
    });
    res.status(201).json({ message: created });
  } catch (err) {
    next(err);
  }
});
var messages_default = router11;

// src/routes/notifications.ts
import { Router as Router12 } from "express";
var router12 = Router12();
router12.use(verifyToken);
router12.get("/", async (req, res, next) => {
  try {
    const db = await getDb();
    const email = req.user.email.toLowerCase();
    const items = await db.notifications.find((n) => n.userEmail.toLowerCase() === email);
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unreadCount = items.filter((n) => !n.read).length;
    res.json({ items: items.slice(0, 25), unreadCount });
  } catch (err) {
    next(err);
  }
});
router12.patch("/read-all", async (req, res, next) => {
  try {
    const db = await getDb();
    const email = req.user.email.toLowerCase();
    await db.notifications.updateMany(
      (n) => n.userEmail.toLowerCase() === email && !n.read,
      (n) => ({ ...n, read: true })
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
router12.patch("/:id/read", async (req, res, next) => {
  try {
    const db = await getDb();
    const email = req.user.email.toLowerCase();
    const target = await db.notifications.findOne((n) => n._id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "Notification not found." });
      return;
    }
    if (target.userEmail.toLowerCase() !== email) {
      res.status(403).json({ error: "Cannot update another user\u2019s notification." });
      return;
    }
    const updated = await db.notifications.updateOne(
      (n) => n._id === target._id,
      (n) => ({ ...n, read: true })
    );
    res.json({ notification: updated });
  } catch (err) {
    next(err);
  }
});
var notifications_default = router12;

// src/routes/quizzes.ts
import { Router as Router13 } from "express";
import crypto7 from "crypto";
import { z as z9 } from "zod";
var QUIZZES = [
  {
    _id: "quiz_math_calculus",
    title: "HSC Higher Math: Limits, Differentiation & Integrals",
    subject: "Mathematics",
    level: "HSC / Admission",
    durationMinutes: 8,
    description: "Assess your calculus fluency with 5 curated board & engineering-track questions.",
    questions: [
      {
        id: "m1",
        prompt: "What is the derivative of f(x) = ln(3x^2 + 1) with respect to x?",
        options: ["6x / (3x^2 + 1)", "1 / (3x^2 + 1)", "6x ln(3x^2 + 1)", "3x / (3x^2 + 1)"],
        correctIndex: 0,
        explanation: "By the chain rule, d/dx[ln(u)] = u'/u, giving 6x / (3x^2 + 1)."
      },
      {
        id: "m2",
        prompt: "Evaluate the limit: lim (x -> 0) [sin(5x) / (2x)].",
        options: ["0", "5/2", "2/5", "1"],
        correctIndex: 1,
        explanation: "Using lim (u->0) sin(u)/u = 1, rewrite as (5/2) * [sin(5x)/(5x)] -> 5/2."
      },
      {
        id: "m3",
        prompt: "What is the value of the definite integral \u222B\u2080\xB9 (3x\xB2 + 2x) dx?",
        options: ["1", "2", "3", "5"],
        correctIndex: 1,
        explanation: "Antiderivative is x\xB3 + x\xB2. Evaluating from 0 to 1 gives (1 + 1) - 0 = 2."
      },
      {
        id: "m4",
        prompt: "At a local extremum where f'(c) = 0 and f''(c) < 0, the function has a:",
        options: ["Local minimum", "Local maximum", "Point of inflection", "Vertical asymptote"],
        correctIndex: 1,
        explanation: "Negative second derivative means concave downward, indicating a local maximum."
      },
      {
        id: "m5",
        prompt: "What is \u222B e^(2x) dx?",
        options: ["2e^(2x) + C", "e^(2x) + C", "(1/2)e^(2x) + C", "e^(x^2) + C"],
        correctIndex: 2,
        explanation: "Substituting u = 2x yields du = 2dx, so the integral is (1/2)e^(2x) + C."
      }
    ]
  },
  {
    _id: "quiz_physics_mechanics",
    title: "Physics Mechanics, Work-Energy & Circular Motion",
    subject: "Physics",
    level: "HSC / A-Level",
    durationMinutes: 8,
    description: "Test core conceptual clarity across kinematics, momentum, and rotational motion.",
    questions: [
      {
        id: "p1",
        prompt: "If a projectile is launched at 45\xB0 with speed v, at the highest point its kinetic energy is what fraction of initial KE?",
        options: ["0", "1/4", "1/2", "3/4"],
        correctIndex: 2,
        explanation: "At the peak, vertical velocity is 0 while horizontal velocity is v cos(45\xB0) = v/\u221A2, so KE = 1/2 mv\xB2 * (1/2)."
      },
      {
        id: "p2",
        prompt: "Which physical quantity remains conserved in an inelastic collision with no external net force?",
        options: ["Kinetic energy", "Linear momentum", "Mechanical power", "Potential energy"],
        correctIndex: 1,
        explanation: "Total linear momentum is conserved in all isolated collisions, even when kinetic energy is lost as heat/sound."
      },
      {
        id: "p3",
        prompt: "A satellite orbits Earth in a circular path. The work done by gravity over one quarter orbit is:",
        options: ["Positive", "Negative", "Zero", "Equal to GMm/r"],
        correctIndex: 2,
        explanation: "Centripetal gravitational force is always perpendicular to instantaneous tangential displacement, so work = 0."
      },
      {
        id: "p4",
        prompt: "Doubling the angular velocity \u03C9 of a solid disc increases its rotational kinetic energy by a factor of:",
        options: ["2", "4", "8", "1/2"],
        correctIndex: 1,
        explanation: "K_rot = 1/2 I\u03C9\xB2, which scales quadratically with \u03C9 (2\xB2 = 4)."
      },
      {
        id: "p5",
        prompt: "The SI unit of impulse is equivalent to the unit of:",
        options: ["Force", "Momentum", "Torque", "Work"],
        correctIndex: 1,
        explanation: "Impulse J = F\u0394t = \u0394p, sharing units (N\xB7s or kg\xB7m/s) with momentum."
      }
    ]
  },
  {
    _id: "quiz_ielts_academic",
    title: "IELTS Academic Grammar, Cohesion & Vocabulary Check",
    subject: "IELTS",
    level: "Band 7.0 - 8.5",
    durationMinutes: 6,
    description: "Sharpen academic sentence precision, cohesive linkers, and high-band collocations.",
    questions: [
      {
        id: "e1",
        prompt: "Choose the sentence with accurate subject-verb agreement:",
        options: [
          "The number of applicants have risen sharply.",
          "The number of applicants has risen sharply.",
          "Neither the tutor nor the students was late.",
          "Each of the modules contain five lessons."
        ],
        correctIndex: 1,
        explanation: '"The number of + plural noun" takes a singular verb ("has"), whereas "Neither A nor B" agrees with the closer plural noun ("students were").'
      },
      {
        id: "e2",
        prompt: "Which cohesive device best introduces a contrasting academic viewpoint?",
        options: ["Furthermore", "Conversely", "Consequently", "Similarly"],
        correctIndex: 1,
        explanation: '"Conversely" explicitly signals an opposite or contrasting perspective.'
      },
      {
        id: "e3",
        prompt: 'Which word is closest in meaning to "ubiquitous" in an academic essay?',
        options: ["Scarce", "Omnipresent", "Temporary", "Controversial"],
        correctIndex: 1,
        explanation: '"Ubiquitous" means found everywhere / omnipresent.'
      },
      {
        id: "e4",
        prompt: "Identify the best Task 1 trend verb for a rapid drop followed by stability:",
        options: ["Plummeted and then plateaued", "Surged and fluctuated", "Escalated steadily", "Remained stagnant throughout"],
        correctIndex: 0,
        explanation: '"Plummeted" describes a sharp decline and "plateaued" describes leveling off.'
      },
      {
        id: "e5",
        prompt: "Select the correctly punctuated complex sentence:",
        options: [
          "Although tuition fees rose, enrollment continued to grow.",
          "Although tuition fees rose; enrollment continued to grow.",
          "Although tuition fees rose. Enrollment continued to grow.",
          "Tuition fees rose, however enrollment continued to grow."
        ],
        correctIndex: 0,
        explanation: 'A dependent clause beginning with "Although" is joined to the main clause with a comma.'
      }
    ]
  },
  {
    _id: "quiz_ict_python",
    title: "ICT & Python Programming Fundamentals",
    subject: "Programming",
    level: "HSC ICT / University",
    durationMinutes: 7,
    description: "Verify core skills in binary logic, time complexity, SQL, and Python data structures.",
    questions: [
      {
        id: "c1",
        prompt: "What is the decimal equivalent of the binary number 10110\u2082?",
        options: ["18", "20", "22", "26"],
        correctIndex: 2,
        explanation: "1\xD716 + 0\xD78 + 1\xD74 + 1\xD72 + 0\xD71 = 22."
      },
      {
        id: "c2",
        prompt: "What is the average-case lookup time complexity of a Python dictionary (hash table)?",
        options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
        correctIndex: 0,
        explanation: "Hash table key lookups run in O(1) average time."
      },
      {
        id: "c3",
        prompt: "In Boolean algebra, what does De Morgan\u2019s Law state for NOT(A AND B)?",
        options: ["(NOT A) AND (NOT B)", "(NOT A) OR (NOT B)", "A OR (NOT B)", "NOT(A OR B)"],
        correctIndex: 1,
        explanation: "Complement of a conjunction equals the disjunction of the complements: !(A\xB7B) = !A + !B."
      },
      {
        id: "c4",
        prompt: "Which SQL clause filters grouped aggregate rows (such as COUNT(*) > 2)?",
        options: ["WHERE", "ORDER BY", "HAVING", "DISTINCT"],
        correctIndex: 2,
        explanation: "HAVING filters groups created by GROUP BY, whereas WHERE filters individual rows prior to grouping."
      },
      {
        id: "c5",
        prompt: "What does `len(set([1, 2, 2, 3, 3, 3]))` evaluate to in Python?",
        options: ["6", "3", "2", "Error"],
        correctIndex: 1,
        explanation: "A Python set stores unique elements only: {1, 2, 3}, which has length 3."
      }
    ]
  }
];
function normalizeAnswerText(raw) {
  return raw.toLowerCase().replace(/[^\p{L}\p{N}\s.+-]/gu, " ").replace(/\.+(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
}
function containsPhrase(haystack, needle) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}
var MAX_REWARD_ATTEMPTS_PER_HOUR = 3;
var quizSubmitLimiter = createRateLimiter({
  windowMs: 6e4,
  max: 15,
  keyPrefix: "quizsubmit",
  message: "Too many quiz submissions. Please slow down."
});
async function tooManyRecentAttempts(db, userId, quizId) {
  const since = Date.now() - 60 * 60 * 1e3;
  const recent = await db.quiz_attempts.count(
    (a) => a.userId === userId && a.quizId === quizId && new Date(a.createdAt).getTime() >= since
  );
  return recent >= MAX_REWARD_ATTEMPTS_PER_HOUR;
}
function maskBreakdownItem(item) {
  const {
    correctIndex: _ci,
    isCorrect: _ic,
    explanation: _ex,
    sampleAnswer: _sa,
    keywords: _kw,
    ...rest
  } = item;
  return rest;
}
function evaluateCqAnswer(submittedRaw, sampleAnswer, keywords) {
  const normSub = normalizeAnswerText(submittedRaw);
  const normSample = normalizeAnswerText(sampleAnswer);
  if (!normSub) return false;
  if (normSub === normSample) return true;
  if (normSample.length >= 2 && containsPhrase(normSub, normSample)) return true;
  const cleanKeywords = (keywords || []).map((k) => normalizeAnswerText(k)).filter((k) => k.length > 0);
  if (cleanKeywords.length > 0) {
    const hits = cleanKeywords.filter((kw) => containsPhrase(normSub, kw)).length;
    const requiredHits = Math.max(1, Math.ceil(cleanKeywords.length * 0.7));
    return hits >= requiredHits;
  }
  const stopWords = /* @__PURE__ */ new Set(["the", "is", "are", "a", "an", "of", "to", "and", "in", "for", "with", "that", "this"]);
  const sampleNumbers = normSample.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (sampleNumbers.length > 0) {
    const allNumsMatch = sampleNumbers.every((num) => containsPhrase(normSub, num));
    if (!allNumsMatch) return false;
  }
  const tokens = normSample.split(" ").filter((t) => t.length > 2 && !stopWords.has(t));
  if (tokens.length === 0) return containsPhrase(normSub, normSample);
  const matched = tokens.filter((t) => normSub.includes(t)).length;
  return matched >= Math.max(1, Math.ceil(tokens.length * 0.6));
}
function sanitizeCustomQuizForSolver(q, viewerId) {
  const mcqCount = q.questions.filter((item) => item.type === "mcq").length;
  const cqCount = q.questions.filter((item) => item.type === "cq").length;
  return {
    _id: q._id,
    title: q.title,
    subject: q.subject,
    level: q.level,
    durationMinutes: q.durationMinutes,
    description: q.description,
    authorId: q.authorId,
    authorName: q.authorName,
    authorImage: q.authorImage || "",
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
      ...item.type === "mcq" ? { options: item.options || [] } : {}
    }))
  };
}
var router13 = Router13();
router13.get("/", optionalAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
    const audience = typeof req.query.audience === "string" ? req.query.audience.trim() : "";
    const kind = typeof req.query.kind === "string" ? req.query.kind.trim() : "";
    const builtinMapped = QUIZZES.map((q) => ({
      _id: q._id,
      title: q.title,
      subject: q.subject,
      level: q.level,
      durationMinutes: q.durationMinutes,
      description: q.description,
      authorId: "platform",
      authorName: "MentorLagbe Academic Team",
      authorImage: "",
      visibility: "public",
      audience: "all",
      approvalStatus: "approved",
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
      createdAt: "2026-01-01T00:00:00.000Z",
      questions: q.questions.map((item) => ({
        id: item.id,
        type: "mcq",
        prompt: item.prompt,
        options: item.options
      }))
    }));
    const customApproved = await db.custom_quizzes.find(
      (q) => q.visibility === "public" && q.approvalStatus === "approved"
    );
    customApproved.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const customMapped = customApproved.map((q) => sanitizeCustomQuizForSolver(q, req.user?._id));
    let combined = [...customMapped, ...builtinMapped];
    if (kind === "custom") {
      combined = combined.filter((q) => !q.isBuiltin);
    } else if (kind === "builtin") {
      combined = combined.filter((q) => q.isBuiltin);
    }
    if (search) {
      combined = combined.filter(
        (q) => q.title.toLowerCase().includes(search) || q.subject.toLowerCase().includes(search) || q.level.toLowerCase().includes(search) || q.description.toLowerCase().includes(search) || q.authorName.toLowerCase().includes(search)
      );
    }
    if (subject && subject !== "All") {
      combined = combined.filter((q) => q.subject.toLowerCase() === subject.toLowerCase());
    }
    if (audience === "students" || audience === "tutors" || audience === "all") {
      combined = combined.filter((q) => q.audience === audience);
    }
    res.json({ items: combined });
  } catch (err) {
    next(err);
  }
});
var shareCodeLookupLimiter = createRateLimiter({
  windowMs: 6e4,
  max: 20,
  keyPrefix: "sharecode",
  message: "Too many share-code lookups. Please wait a minute."
});
router13.get("/shared/:code", optionalAuth, shareCodeLookupLimiter, async (req, res, next) => {
  try {
    const rawCode = String(req.params.code || "").trim().toUpperCase();
    if (!rawCode) {
      res.status(400).json({ error: "Share code is required." });
      return;
    }
    const db = await getDb();
    const quiz = await db.custom_quizzes.findOne((q) => q.shareCode.toUpperCase() === rawCode);
    if (!quiz) {
      res.status(404).json({ error: "Private quiz not found for this share link or code." });
      return;
    }
    const isAuthorOrAdmin = req.user && (req.user._id === quiz.authorId || req.user.role === "admin");
    if (quiz.approvalStatus !== "approved" && !isAuthorOrAdmin) {
      res.status(403).json({
        error: "This quiz is awaiting Admin approval before participants can play it."
      });
      return;
    }
    res.json({ quiz: sanitizeCustomQuizForSolver(quiz, req.user?._id) });
  } catch (err) {
    next(err);
  }
});
router13.get("/mine", verifyToken, async (req, res, next) => {
  try {
    if (req.user.role !== "tutor" && req.user.role !== "admin") {
      res.status(403).json({ error: "Only Tutors and Admins can manage published quizzes." });
      return;
    }
    const db = await getDb();
    const [items, freshUser] = await Promise.all([
      db.custom_quizzes.find(
        (q) => q.authorId === req.user._id || q.authorEmail.toLowerCase() === req.user.email.toLowerCase()
      ),
      db.users.findOne((u) => u._id === req.user._id)
    ]);
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({
      items,
      walletCoins: freshUser?.coins ?? req.user.coins ?? 0
    });
  } catch (err) {
    next(err);
  }
});
var customQuestionSchema = z9.discriminatedUnion("type", [
  z9.object({
    id: z9.string().trim().optional(),
    type: z9.literal("mcq"),
    prompt: z9.string().trim().min(5, "Question prompt must be at least 5 characters").max(500),
    options: z9.array(z9.string().trim().min(1, "All 4 MCQ options must be filled").max(200)).length(4, "Each MCQ must have exactly 4 options"),
    correctIndex: z9.number().int().min(0).max(3),
    explanation: z9.string().trim().min(3, "Solution explanation is required").max(600)
  }),
  z9.object({
    id: z9.string().trim().optional(),
    type: z9.literal("cq"),
    prompt: z9.string().trim().min(5, "CQ prompt must be at least 5 characters").max(800),
    sampleAnswer: z9.string().trim().min(2, "Expected/model answer is required for CQ grading").max(1e3),
    keywords: z9.array(z9.string().trim().max(80)).max(12).optional().default([]),
    explanation: z9.string().trim().min(3, "Solution explanation is required").max(600)
  })
]);
var createCustomQuizSchema = z9.object({
  title: z9.string().trim().min(4, "Title must be at least 4 characters").max(140),
  subject: z9.string().trim().min(2, "Subject is required").max(60),
  level: z9.string().trim().min(2, "Class/Level is required").max(60),
  durationMinutes: z9.number().int().min(2).max(180),
  description: z9.string().trim().min(10, "Description must be at least 10 characters").max(500),
  visibility: z9.enum(["public", "private"]),
  audience: z9.enum(["all", "students", "tutors"]),
  rewardPerWinner: z9.number().int().min(0).max(1e3),
  maxWinners: z9.number().int().min(0).max(2e3),
  questions: z9.array(customQuestionSchema).min(1, "Add at least 1 MCQ or CQ question").max(30, "Maximum 30 questions per quiz")
}).refine(
  (data) => data.rewardPerWinner === 0 && data.maxWinners === 0 || data.rewardPerWinner > 0 && data.maxWinners >= 1,
  {
    message: "Set both reward coins per winner and winner slots (or leave both at 0 for a practice quiz).",
    path: ["maxWinners"]
  }
);
router13.post("/custom", verifyToken, async (req, res, next) => {
  try {
    if (req.user.role !== "tutor" && req.user.role !== "admin") {
      res.status(403).json({ error: "Only Tutors and Admins can publish quizzes." });
      return;
    }
    const parsed = createCustomQuizSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid quiz payload." });
      return;
    }
    const db = await getDb();
    const author = await db.users.findOne((u) => u._id === req.user._id);
    if (!author) {
      res.status(404).json({ error: "User account not found." });
      return;
    }
    const totalRewardPool = parsed.data.rewardPerWinner * parsed.data.maxWinners;
    const currentCoins = author.coins ?? 0;
    if (totalRewardPool > currentCoins) {
      res.status(400).json({
        error: `Insufficient coin balance. This reward pool requires ${totalRewardPool} coins, but you currently have ${currentCoins} coins.`,
        code: "INSUFFICIENT_COINS"
      });
      return;
    }
    const normalizedQuestions = parsed.data.questions.map(
      (q, idx) => q.type === "mcq" ? {
        id: q.id || `q_${idx + 1}_${generateId().slice(0, 6)}`,
        type: "mcq",
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation
      } : {
        id: q.id || `q_${idx + 1}_${generateId().slice(0, 6)}`,
        type: "cq",
        prompt: q.prompt,
        sampleAnswer: q.sampleAnswer,
        keywords: (q.keywords || []).filter((k) => k.trim().length > 0),
        explanation: q.explanation
      }
    );
    const shareCode = `MLQ-${crypto7.randomBytes(4).toString("hex").toUpperCase()}`;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let walletAfter = currentCoins;
    if (totalRewardPool > 0) {
      const spent = await adjustCoins(db, author._id, -totalRewardPool);
      if (!spent) {
        res.status(400).json({
          error: `Insufficient coin balance. This reward pool requires ${totalRewardPool} coins.`,
          code: "INSUFFICIENT_COINS"
        });
        return;
      }
      walletAfter = spent.coins ?? 0;
    }
    let created;
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
        approvalStatus: "pending",
        rewardPerWinner: parsed.data.rewardPerWinner,
        maxWinners: parsed.data.maxWinners,
        winnersCount: 0,
        winnerUserIds: [],
        rewardPoolTotal: totalRewardPool,
        rewardPoolRemaining: totalRewardPool,
        questions: normalizedQuestions,
        createdAt: nowIso
      });
    } catch (insertErr) {
      if (totalRewardPool > 0) await adjustCoins(db, author._id, totalRewardPool);
      throw insertErr;
    }
    await createNotification(db, {
      userEmail: author.email,
      title: "Quiz Submitted for Admin Review",
      message: `"${created.title}" has been submitted${totalRewardPool > 0 ? ` with a ${totalRewardPool}-coin reward pool` : ""}. An Admin will review and approve it shortly.`,
      type: "moderation",
      link: "/dashboard/tutor/quizzes"
    });
    res.status(201).json({
      quiz: created,
      walletCoins: walletAfter
    });
  } catch (err) {
    next(err);
  }
});
router13.patch("/custom/:id/visibility", verifyToken, async (req, res, next) => {
  try {
    const schema = z9.object({ visibility: z9.enum(["public", "private"]) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Visibility must be public or private." });
      return;
    }
    const db = await getDb();
    const existing = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }
    const isOwner = existing.authorId === req.user._id || existing.authorEmail.toLowerCase() === req.user.email.toLowerCase();
    if (!isOwner && req.user.role !== "admin") {
      res.status(403).json({ error: "Only the quiz creator or Admin can change visibility." });
      return;
    }
    const updated = await db.custom_quizzes.updateOne(
      (q) => q._id === existing._id,
      (q) => ({
        ...q,
        visibility: parsed.data.visibility,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      })
    );
    res.json({ quiz: updated });
  } catch (err) {
    next(err);
  }
});
router13.delete("/custom/:id", verifyToken, async (req, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }
    const isOwner = existing.authorId === req.user._id || existing.authorEmail.toLowerCase() === req.user.email.toLowerCase();
    if (!isOwner && req.user.role !== "admin") {
      res.status(403).json({ error: "You cannot delete another tutor\u2019s quiz." });
      return;
    }
    const refundAmount = existing.rewardPoolRemaining > 0 ? existing.rewardPoolRemaining : 0;
    const deleted = await db.custom_quizzes.deleteOne((q) => q._id === existing._id);
    if (!deleted) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }
    let updatedAuthorCoins;
    if (refundAmount > 0) {
      const refundedUser = await adjustCoins(db, existing.authorId, refundAmount);
      updatedAuthorCoins = refundedUser?.coins;
    }
    res.json({
      message: refundAmount > 0 ? `Quiz deleted and ${refundAmount} unclaimed coins refunded.` : "Quiz deleted.",
      refundedCoins: refundAmount,
      walletCoins: updatedAuthorCoins
    });
  } catch (err) {
    next(err);
  }
});
router13.get("/admin/all", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const db = await getDb();
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    let items = await db.custom_quizzes.findAll();
    if (status && status !== "all") {
      items = items.filter((q) => q.approvalStatus === status);
    }
    const statusOrder = { pending: 0, approved: 1, rejected: 2 };
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
router13.patch("/custom/:id/moderation", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const schema = z9.object({
      approvalStatus: z9.enum(["pending", "approved", "rejected"]),
      rejectionReason: z9.string().trim().max(400).optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid moderation status payload." });
      return;
    }
    const db = await getDb();
    const existing = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Custom quiz not found." });
      return;
    }
    if (parsed.data.approvalStatus === "approved" && existing.approvalStatus === "rejected" && existing.rewardPoolTotal > 0 && existing.rewardPoolRemaining === 0 && existing.winnersCount === 0) {
      res.status(400).json({
        error: "This rejected quiz already had its coin pool refunded. Ask the tutor to publish a new quiz."
      });
      return;
    }
    let refundCoins = 0;
    if (parsed.data.approvalStatus === "rejected" && existing.rewardPoolRemaining > 0) {
      const swapped = await db.custom_quizzes.replaceIfUnchanged(
        existing._id,
        { rewardPoolRemaining: existing.rewardPoolRemaining },
        { ...existing, rewardPoolRemaining: 0 }
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
        ...typeof parsed.data.rejectionReason === "string" ? { rejectionReason: parsed.data.rejectionReason } : {},
        ...refundCoins > 0 ? { rewardPoolRemaining: 0 } : {},
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      })
    );
    if (parsed.data.approvalStatus !== existing.approvalStatus) {
      await createNotification(db, {
        userEmail: existing.authorEmail,
        title: `Quiz ${parsed.data.approvalStatus}`,
        message: parsed.data.approvalStatus === "approved" ? `Your quiz "${existing.title}" is approved and ready (${existing.visibility === "private" ? "share via private link" : "live in Quiz Hub"}).` : `Your quiz "${existing.title}" was rejected.${refundCoins > 0 ? ` ${refundCoins} coins were refunded to your wallet.` : ""}`,
        type: "moderation",
        link: "/dashboard/tutor/quizzes"
      });
    }
    res.json({ quiz: updated, refundedCoins: refundCoins });
  } catch (err) {
    next(err);
  }
});
router13.post("/custom/:id/submit", verifyToken, quizSubmitLimiter, async (req, res, next) => {
  try {
    const db = await getDb();
    const quiz = await db.custom_quizzes.findOne((q) => q._id === req.params.id);
    if (!quiz) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }
    const isAuthorOrAdmin = req.user._id === quiz.authorId || req.user.role === "admin";
    if (quiz.approvalStatus !== "approved" && !isAuthorOrAdmin) {
      res.status(403).json({ error: "This quiz is pending Admin approval and cannot be submitted yet." });
      return;
    }
    const submitSchema = z9.object({
      answers: z9.record(z9.string(), z9.number().int().min(0).max(10)).optional().default({}),
      writtenAnswers: z9.record(z9.string(), z9.string().max(2e3)).optional().default({}),
      shareCode: z9.string().trim().max(40).optional()
    });
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid quiz submission payload." });
      return;
    }
    if (quiz.visibility === "private" && !isAuthorOrAdmin) {
      const provided = (parsed.data.shareCode || "").trim().toUpperCase();
      if (!provided || provided !== quiz.shareCode.toUpperCase()) {
        res.status(403).json({ error: "Valid private share link code is required for this quiz." });
        return;
      }
    }
    if (quiz.audience === "students" && req.user.role !== "student" && req.user.role !== "admin") {
      res.status(403).json({ error: "This quiz is exclusively for Students." });
      return;
    }
    if (quiz.audience === "tutors" && req.user.role !== "tutor" && req.user.role !== "admin") {
      res.status(403).json({ error: "This quiz is exclusively for Tutors." });
      return;
    }
    const prizeAtStake = !isAuthorOrAdmin && quiz.approvalStatus === "approved" && quiz.rewardPerWinner > 0 && quiz.rewardPoolRemaining >= quiz.rewardPerWinner && quiz.winnersCount < quiz.maxWinners && !quiz.winnerUserIds.includes(req.user._id);
    if (prizeAtStake && await tooManyRecentAttempts(db, req.user._id, quiz._id)) {
      res.status(429).json({
        error: "Attempt limit reached for this reward quiz. Please wait an hour before trying again.",
        code: "ATTEMPT_LIMIT"
      });
      return;
    }
    let score = 0;
    const breakdown = quiz.questions.map((q) => {
      if (q.type === "mcq") {
        const selectedIndex = typeof parsed.data.answers[q.id] === "number" ? parsed.data.answers[q.id] : -1;
        const isCorrect2 = selectedIndex === q.correctIndex;
        if (isCorrect2) score += 1;
        return {
          id: q.id,
          type: "mcq",
          prompt: q.prompt,
          options: q.options || [],
          selectedIndex,
          correctIndex: q.correctIndex ?? 0,
          isCorrect: isCorrect2,
          explanation: q.explanation
        };
      }
      const submittedText = String(parsed.data.writtenAnswers[q.id] || "").trim();
      const isCorrect = evaluateCqAnswer(submittedText, q.sampleAnswer || "", q.keywords);
      if (isCorrect) score += 1;
      return {
        id: q.id,
        type: "cq",
        prompt: q.prompt,
        submittedText,
        sampleAnswer: q.sampleAnswer || "",
        keywords: q.keywords || [],
        isCorrect,
        explanation: q.explanation
      };
    });
    const total = quiz.questions.length;
    const percentage = total > 0 ? Math.round(score / total * 100) : 0;
    const allCorrect = total > 0 && score === total;
    let coinsEarned = 0;
    let rewardNote = "";
    let prizeClaimed = false;
    if (allCorrect && prizeAtStake) {
      for (let tries = 0; tries < 4 && !prizeClaimed; tries += 1) {
        const fresh = await db.custom_quizzes.findById(quiz._id);
        if (!fresh || fresh.approvalStatus !== "approved" || fresh.rewardPerWinner <= 0 || fresh.rewardPoolRemaining < fresh.rewardPerWinner || fresh.winnersCount >= fresh.maxWinners || fresh.winnerUserIds.includes(req.user._id)) {
          break;
        }
        prizeClaimed = await db.custom_quizzes.replaceIfUnchanged(
          fresh._id,
          { winnersCount: fresh.winnersCount, rewardPoolRemaining: fresh.rewardPoolRemaining },
          {
            ...fresh,
            winnersCount: fresh.winnersCount + 1,
            winnerUserIds: [...fresh.winnerUserIds, req.user._id],
            rewardPoolRemaining: fresh.rewardPoolRemaining - fresh.rewardPerWinner,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        );
        if (prizeClaimed) coinsEarned = fresh.rewardPerWinner;
      }
    }
    if (prizeClaimed) {
      await adjustCoins(db, req.user._id, coinsEarned);
      await createNotification(db, {
        userEmail: req.user.email,
        title: `Won +${coinsEarned} Coins!`,
        message: `You answered all ${total} questions correctly in "${quiz.title}" and earned ${coinsEarned} coins.`,
        type: "system",
        link: "/quizzes"
      });
      rewardNote = `Congratulations! You answered every question correctly and earned +${coinsEarned} coins.`;
    } else if (allCorrect && quiz.winnerUserIds.includes(req.user._id)) {
      rewardNote = "You already claimed the coin reward for this quiz on an earlier attempt.";
    } else if (allCorrect && quiz.rewardPerWinner > 0 && quiz.rewardPoolRemaining < quiz.rewardPerWinner) {
      rewardNote = "Great score! All coin winner slots for this quiz have already been claimed.";
    } else if (allCorrect && req.user._id === quiz.authorId) {
      rewardNote = "Author preview attempt complete (authors cannot claim their own quiz pool).";
    } else if (!allCorrect && quiz.rewardPerWinner > 0 && quiz.rewardPoolRemaining >= quiz.rewardPerWinner) {
      rewardNote = `Answer all ${total} questions correctly to win +${quiz.rewardPerWinner} coins.`;
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
      passed: allCorrect,
      writtenAnswers: parsed.data.writtenAnswers,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const latestUser = await db.users.findOne((u) => u._id === req.user._id);
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
      walletCoins: latestUser?.coins ?? req.user.coins ?? 0,
      rewardPoolRemaining: latestQuiz?.rewardPoolRemaining ?? quiz.rewardPoolRemaining,
      winnersCount: latestQuiz?.winnersCount ?? quiz.winnersCount,
      // While a coin prize is still at stake, correct answers stay hidden until the solver wins it.
      breakdown: allCorrect || !prizeAtStake ? breakdown : breakdown.map((item) => maskBreakdownItem(item))
    });
  } catch (err) {
    next(err);
  }
});
router13.get("/attempts/mine", verifyToken, async (req, res, next) => {
  try {
    const db = await getDb();
    const items = await db.quiz_attempts.find((a) => a.userId === req.user._id);
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ items: items.slice(0, 20) });
  } catch (err) {
    next(err);
  }
});
function formatProgressSummary(doc, todayKey) {
  const completedLevel = doc?.completedLevel ?? 0;
  const lastCompletedDate = doc?.lastCompletedDate ?? null;
  const completedToday = Boolean(lastCompletedDate && lastCompletedDate === todayKey);
  const prevKey = getPreviousDhakaDateKey(todayKey);
  const activeStreak = doc && (doc.lastCompletedDate === todayKey || doc.lastCompletedDate === prevKey) ? doc.streak : 0;
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
    unlockedBadgeLevels: [...doc?.unlockedBadgeLevels ?? []].sort((a, b) => a - b)
  };
}
function parseQueryTrack(raw) {
  if (raw === "tutor" || raw === "student") return raw;
  return null;
}
router13.get("/daily/overview", optionalAuth, async (req, res, next) => {
  try {
    const todayKey = getDhakaDateKey();
    const userTrack = req.user ? resolveDailyTrack(req.user.role) : "student";
    const requestedTrack = parseQueryTrack(req.query.track);
    const activeTrack = requestedTrack ?? userTrack;
    const isOwnTrack = Boolean(req.user && (req.user.role === "admin" || activeTrack === userTrack));
    let progressDoc = null;
    if (req.user && isOwnTrack) {
      const db = await getDb();
      progressDoc = await db.quiz_daily_progress.findOne((p) => p.userId === req.user._id);
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
        unlocked: unlockedSet.has(b.level)
      }))
    });
  } catch (err) {
    next(err);
  }
});
router13.get("/daily/level/:level", optionalAuth, async (req, res, next) => {
  try {
    const level = Number(req.params.level);
    if (!Number.isInteger(level) || level < 1 || level > TOTAL_DAILY_LEVELS) {
      res.status(400).json({ error: `Level must be an integer between 1 and ${TOTAL_DAILY_LEVELS}.` });
      return;
    }
    const todayKey = getDhakaDateKey();
    const userTrack = req.user ? resolveDailyTrack(req.user.role) : "student";
    const requestedTrack = parseQueryTrack(req.query.track);
    const activeTrack = requestedTrack ?? userTrack;
    const isOwnTrack = Boolean(req.user && (req.user.role === "admin" || activeTrack === userTrack));
    let isReplay = false;
    if (!req.user || !isOwnTrack) {
      if (level !== 1) {
        res.status(req.user ? 403 : 401).json({
          error: req.user ? `Your account belongs to the ${userTrack === "tutor" ? "Tutor" : "Student"} Daily Track. Switch back to your track to continue past Level 1.` : "Please sign in to unlock and track progress across all 1,000 levels.",
          code: req.user ? "TRACK_PREVIEW_ONLY" : "AUTH_REQUIRED"
        });
        return;
      }
    } else {
      const db = await getDb();
      const progressDoc = await db.quiz_daily_progress.findOne((p) => p.userId === req.user._id);
      const completedLevel = progressDoc?.completedLevel ?? 0;
      const completedToday = Boolean(progressDoc && progressDoc.lastCompletedDate === todayKey);
      isReplay = level <= completedLevel;
      if (level > completedLevel + 1) {
        res.status(403).json({
          error: `Level ${level} is locked. Pass Level ${completedLevel + 1} next to advance.`,
          code: "LEVEL_LOCKED"
        });
        return;
      }
      if (!isReplay && completedToday) {
        res.status(403).json({
          error: "Daily limit reached: you already completed 1 new level today. Replay completed levels or return tomorrow!",
          code: "DAILY_LIMIT_REACHED"
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
        options: q.options
      }))
    });
  } catch (err) {
    next(err);
  }
});
router13.post("/daily/level/:level/submit", verifyToken, quizSubmitLimiter, async (req, res, next) => {
  try {
    const level = Number(req.params.level);
    if (!Number.isInteger(level) || level < 1 || level > TOTAL_DAILY_LEVELS) {
      res.status(400).json({ error: `Level must be an integer between 1 and ${TOTAL_DAILY_LEVELS}.` });
      return;
    }
    const schema = z9.object({
      answers: z9.record(z9.string(), z9.number().int().min(0).max(3))
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid quiz submission payload." });
      return;
    }
    const track = resolveDailyTrack(req.user.role);
    const db = await getDb();
    const todayKey = getDhakaDateKey();
    let progressDoc = await db.quiz_daily_progress.findOne((p) => p.userId === req.user._id);
    const completedLevel = progressDoc?.completedLevel ?? 0;
    const completedToday = Boolean(progressDoc && progressDoc.lastCompletedDate === todayKey);
    const isReplay = level <= completedLevel;
    if (level > completedLevel + 1) {
      res.status(403).json({
        error: `Level ${level} is locked. Pass Level ${completedLevel + 1} next to advance.`,
        code: "LEVEL_LOCKED"
      });
      return;
    }
    if (!isReplay && completedToday) {
      res.status(403).json({
        error: "Daily limit reached: you can only advance 1 new level per day. Replay completed levels or return tomorrow!",
        code: "DAILY_LIMIT_REACHED"
      });
      return;
    }
    const dailyQuizId = `daily_${track}_level_${level}`;
    if (!isReplay && await tooManyRecentAttempts(db, req.user._id, dailyQuizId)) {
      res.status(429).json({
        error: "Too many attempts on this level. Please wait an hour before trying again.",
        code: "ATTEMPT_LIMIT"
      });
      return;
    }
    const quizDef = generateDailyLevelQuiz(level, track);
    let score = 0;
    const breakdown = quizDef.questions.map((q) => {
      const selectedIndex = typeof parsed.data.answers[q.id] === "number" ? parsed.data.answers[q.id] : -1;
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
        explanation: q.explanation
      };
    });
    const total = quizDef.questions.length;
    const percentage = Math.round(score / total * 100);
    const passed = score >= quizDef.passingScore;
    let newlyUnlockedBadge = null;
    let xpAwarded = 0;
    let coinsAwarded = 0;
    if (!isReplay && passed) {
      const prevKey = getPreviousDhakaDateKey(todayKey);
      const nextStreak = progressDoc && progressDoc.lastCompletedDate === prevKey ? progressDoc.streak + 1 : 1;
      const nextXp = (progressDoc?.totalXp ?? 0) + quizDef.xpReward;
      const nextBadges = new Set(progressDoc?.unlockedBadgeLevels ?? []);
      if (quizDef.badge && !nextBadges.has(quizDef.badge.level)) {
        nextBadges.add(quizDef.badge.level);
        newlyUnlockedBadge = quizDef.badge;
      }
      const sortedBadges = Array.from(nextBadges).sort((a, b) => a - b);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
          updatedAt: nowIso
        };
        levelClaimed = await db.quiz_daily_progress.replaceIfUnchanged(
          progressDoc._id,
          {
            completedLevel: progressDoc.completedLevel,
            lastCompletedDate: progressDoc.lastCompletedDate
          },
          nextDoc
        );
        if (levelClaimed) progressDoc = nextDoc;
      } else {
        try {
          progressDoc = await db.quiz_daily_progress.insertOne({
            _id: `dqp_${generateId()}`,
            userId: req.user._id,
            userEmail: req.user.email,
            track,
            completedLevel: level,
            lastCompletedDate: todayKey,
            streak: nextStreak,
            totalXp: nextXp,
            unlockedBadgeLevels: sortedBadges,
            updatedAt: nowIso
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
        await adjustCoins(db, req.user._id, coinsAwarded);
      }
      if (levelClaimed) await db.quiz_attempts.insertOne({
        _id: `qatt_${generateId()}`,
        userId: req.user._id,
        userEmail: req.user.email,
        quizId: `daily_${track}_level_${level}`,
        quizTitle: quizDef.title,
        subject: track === "tutor" ? "Tutor Daily 1,000-Level" : "Student Daily 1,000-Level",
        score,
        total,
        percentage,
        coinsEarned: coinsAwarded,
        passed: true,
        createdAt: nowIso
      });
      if (newlyUnlockedBadge) {
        await createNotification(db, {
          userEmail: req.user.email,
          title: `${track === "tutor" ? "Tutor" : "Student"} Badge Unlocked: ${newlyUnlockedBadge.name}`,
          message: `You passed Level ${level} (${score}/${total}), earned +${coinsAwarded} coins, and unlocked the ${newlyUnlockedBadge.tier} milestone badge.`,
          type: "system",
          link: "/quizzes?mode=daily"
        });
      }
    }
    if (!isReplay && !passed) {
      await db.quiz_attempts.insertOne({
        _id: `qatt_${generateId()}`,
        userId: req.user._id,
        userEmail: req.user.email,
        quizId: dailyQuizId,
        quizTitle: quizDef.title,
        subject: track === "tutor" ? "Tutor Daily 1,000-Level" : "Student Daily 1,000-Level",
        score,
        total,
        percentage,
        coinsEarned: 0,
        passed: false,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const latestUser = await db.users.findById(req.user._id);
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
      walletCoins: latestUser?.coins ?? req.user.coins ?? 0,
      isReplay,
      newlyUnlockedBadge,
      progress: formatProgressSummary(progressDoc, todayKey),
      // Answers are revealed only once the level is passed (or when replaying a finished level).
      breakdown: isReplay || passed ? breakdown : breakdown.map((item) => maskBreakdownItem(item))
    });
  } catch (err) {
    next(err);
  }
});
router13.post("/:id/submit", optionalAuth, quizSubmitLimiter, async (req, res, next) => {
  try {
    const quiz = QUIZZES.find((q) => q._id === req.params.id);
    if (!quiz) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }
    const schema = z9.object({
      answers: z9.record(z9.string(), z9.number().int().min(0).max(10))
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid quiz submission payload." });
      return;
    }
    if (req.user) {
      const dbForCap = await getDb();
      const alreadyRewarded = await dbForCap.quiz_attempts.findOne(
        (a) => a.userId === req.user._id && a.quizId === quiz._id && (a.coinsEarned ?? 0) > 0
      );
      if (!alreadyRewarded && await tooManyRecentAttempts(dbForCap, req.user._id, quiz._id)) {
        res.status(429).json({
          error: "Too many attempts on this quiz. Please wait an hour before trying again.",
          code: "ATTEMPT_LIMIT"
        });
        return;
      }
    }
    let score = 0;
    const breakdown = quiz.questions.map((q) => {
      const selectedIndex = typeof parsed.data.answers[q.id] === "number" ? parsed.data.answers[q.id] : -1;
      const isCorrect = selectedIndex === q.correctIndex;
      if (isCorrect) score += 1;
      return {
        id: q.id,
        type: "mcq",
        prompt: q.prompt,
        options: q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation
      };
    });
    const total = quiz.questions.length;
    const percentage = Math.round(score / total * 100);
    let coinsEarned = 0;
    let walletCoins = req.user?.coins ?? 0;
    if (req.user) {
      const db = await getDb();
      if (percentage >= 60) {
        const priorRewarded = await db.quiz_attempts.findOne(
          (a) => a.userId === req.user._id && a.quizId === quiz._id && (a.coinsEarned ?? 0) > 0
        );
        if (!priorRewarded) {
          const firstClaim = await db.users.claimOnce(req.user._id, "claimedQuizIds", quiz._id);
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
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
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
      breakdown: percentage >= 60 ? breakdown : breakdown.map((item) => maskBreakdownItem(item))
    });
  } catch (err) {
    next(err);
  }
});
var quizzes_default = router13;

// src/app.ts
var ASSETS_DIR = path3.resolve(path3.dirname(fileURLToPath3(import.meta.url)), "..", "assets");
async function createApiApp() {
  validateRuntimeEnvironment();
  const app = express2();
  const isProd = process.env.NODE_ENV === "production";
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  const db = await getDb();
  if (!isProd && process.env.SEED_DEMO_DATA !== "false") {
    await seedDatabaseIfEmpty(db);
    if (extraFeaturesEnabled()) await ensureExtrasSeeded(db);
  }
  const betterAuthInstance = await getBetterAuth();
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isProd && (req.secure || req.headers["x-forwarded-proto"] === "https")) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  app.use((req, res, next) => {
    const requestHost = typeof req.headers.host === "string" ? req.headers.host : void 0;
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, requestHost)) {
          callback(null, true);
        } else {
          callback(new Error("Origin not allowed by CORS policy"));
        }
      },
      credentials: true
    })(req, res, (err) => {
      if (err) {
        res.status(403).json({ error: "CORS origin denied." });
        return;
      }
      next();
    });
  });
  app.all("/api/better-auth/*", toNodeHandler(betterAuthInstance));
  app.post(
    "/api/payments/webhook",
    express2.raw({ type: "application/json" }),
    stripeWebhookHandler
  );
  app.use(cookieParser());
  app.use(csrfOriginCheck);
  app.use(express2.json({ limit: "10mb" }));
  app.use(express2.urlencoded({ extended: true, limit: "10mb" }));
  try {
    if (!fs3.existsSync(UPLOAD_DIR)) {
      fs3.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  } catch {
  }
  app.use("/api/uploads", express2.static(UPLOAD_DIR));
  app.use("/api/assets", express2.static(ASSETS_DIR, { maxAge: "7d" }));
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      dbMode: db.mode,
      env: isProd ? "production" : "development"
    });
  });
  app.get("/api/health/ready", async (_req, res) => {
    const ping = await pingDb();
    if (!ping.ok) {
      res.status(503).json({ ok: false, dbMode: ping.mode, error: "Database readiness check failed." });
      return;
    }
    res.json({ ok: true, dbMode: ping.mode });
  });
  app.use("/api", (req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      apiWriteRateLimiter(req, res, next);
      return;
    }
    next();
  });
  app.use("/api/auth", auth_default);
  app.use("/api/tuitions", tuitions_default);
  app.use("/api/applications", applications_default);
  app.use("/api/users", users_default);
  app.use("/api/payments", payments_default);
  app.use("/api/admin", admin_default);
  app.use("/api/upload", upload_default);
  app.use("/api/tutors", tutors_default);
  if (extraFeaturesEnabled()) {
    app.use("/api/resources", resources_default);
    app.use("/api/tutor-requests", tutorRequests_default);
    app.use("/api/messages", messages_default);
    app.use("/api/notifications", notifications_default);
    app.use("/api/quizzes", quizzes_default);
  }
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });
  app.use(errorHandler);
  return app;
}

// src/vercel.ts
var appPromise = null;
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function handler(req, res) {
  try {
    if (req.method === "POST" && (req.url || "").split("?")[0] === "/api/payments/webhook") {
      const raw = await readRawBody(req);
      Object.defineProperty(req, "body", { value: raw, writable: true, configurable: true });
      req._body = true;
    }
    appPromise ??= createApiApp();
    const app = await appPromise;
    app(req, res);
  } catch (err) {
    appPromise = null;
    console.error("[MentorLagbe API] Failed to start on Vercel:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server failed to start. Check the environment variables in Vercel." }));
  }
}
export {
  handler as default
};
