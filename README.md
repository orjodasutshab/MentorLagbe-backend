# MentorLagbe — Backend API Server

**Project Name:** MentorLagbe (Smart Tuition & Mentorship Platform)
**Purpose:** Express + MongoDB REST API for a role-based tuition platform. Tutors post tuition batches, admins moderate them, students search and apply, and both tutors and students can upgrade to a Pro plan through Stripe.

**Live Server URL:** `<add your deployed server link>`
**Live Client URL:** `<add your deployed client link>`
**Client Repository:** `<add your client repo link>`

## Admin & Test Credentials
| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@mentorlagbe.com` | `Admin@1234` |
| Tutor (Pro) | `tutor@mentorlagbe.com` | `Tutor@1234` |
| Tutor (Free) | `nusrat.tutor@mentorlagbe.com` | `Tutor@1234` |
| Student (Free) | `student@mentorlagbe.com` | `Student@1234` |
| Student (Pro) | `sadia.student@mentorlagbe.com` | `Student@1234` |

These accounts are created by `npm run seed` (see below). Demo data is never seeded automatically in production.

## Key Features
- **Three roles** (`student`, `tutor`, `admin`) protected by the custom middlewares `verifyToken`, `verifyStudent`, `verifyTutor`, `verifyAdmin`.
- **Four business collections:** `users`, `tuitions`, `applications`, `payments` (plus `auth_sessions` for login sessions). Optional extras are off unless `ENABLE_EXTRA_FEATURES=true`.
- **Tuition moderation:** new posts are `pending`; admin approves or rejects. Only `approved` and `isActive` posts are public. Editing an approved post sends it back for review.
- **Server-side search, filter and pagination** (title/subject search, class level, mode, `page`/`limit`) using MongoDB queries.
- **Applications:** only students can apply, duplicate applications are blocked, students can cancel pending ones, tutors accept or reject.
- **Free vs Pro limits:** free tutors can post 2 tuitions, Pro unlimited; free students can bookmark 5, Pro unlimited.
- **Reviews:** only students with an accepted application can leave a 1–5 star review.
- **Stripe Checkout + webhook:** Tutor Pro $15, Student Pro $10; payment is recorded once and the user's plan becomes `pro`.
- **Image upload:** `POST /api/upload` uploads to Cloudinary or ImgBB (see `.env.example`).
- **Security:** JWT + HTTP-only cookie sessions, bcrypt password hashing, rate limiting, CORS allow-list, Origin check for cookie requests, zod validation.

## Environment Variables
Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

## Deploy on Vercel
1. Push this folder to its own GitHub repo (keep `api/index.mjs`, `vercel.json`, `public/` and `assets/`).
2. Vercel → Add New Project → import the repo → Framework Preset **Other**.
3. Add the variables from `.env.vercel.example` in Settings → Environment Variables, then deploy.
4. Open `/api/health` on your link; it should return `ok: true`.
5. After changing anything in `src/`, run `npm run build:vercel` and commit the updated `api/index.mjs` before pushing.
6. Stripe webhook URL: `https://<your-backend>.vercel.app/api/payments/webhook` (event `checkout.session.completed`).

## Scripts
```bash
npm install
cp .env.example .env
npm run seed    # fills the database with demo users, 13 tuitions, applications and payments
npm run dev     # development server
npm start       # production server
npm run lint    # TypeScript check
```
To seed the live (Atlas) database once, put your Atlas `MONGODB_URI` in `.env` and run `npm run seed` from your computer.

## Main API Endpoints
| Group | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/sign-up`, `POST /api/auth/sign-in`, `POST /api/auth/sign-out`, `GET /api/auth/session` |
| Tuitions | `GET /api/tuitions`, `GET /api/tuitions/:id`, `GET /api/tuitions/tutor/mine`, `POST /api/tuitions`, `PATCH /api/tuitions/:id`, `DELETE /api/tuitions/:id`, `POST /api/tuitions/:id/reviews` |
| Applications | `POST /api/applications`, `GET /api/applications/student`, `DELETE /api/applications/:id`, `GET /api/applications/tutor`, `PATCH /api/applications/:id/status` |
| Users | `PATCH /api/users/profile`, `GET /api/users/saved-tuitions`, `POST /api/users/saved-tuitions/:tuitionId` |
| Payments | `POST /api/payments/create-checkout-session`, `POST /api/payments/verify-session`, `POST /api/payments/webhook`, `GET /api/payments/my` |
| Admin | `GET /api/admin/overview`, `GET /api/admin/users`, `PATCH /api/admin/users/:id/role`, `GET /api/admin/tuitions`, `PATCH /api/admin/tuitions/:id`, `GET /api/admin/transactions` |
| Upload | `POST /api/upload` |

## npm Packages Used
`express`, `mongodb`, `better-auth`, `jsonwebtoken`, `bcryptjs`, `stripe`, `zod`, `cors`, `cookie-parser`, `dotenv`, `tsx`, `typescript`
