# Security & bug fixes

- Demo seed data (public admin password) never runs when NODE_ENV=production.
- Quiz answers hidden until pass/win; reward quizzes limited to 3 graded attempts per hour.
- Coins, prize slots, daily-level rewards and built-in quiz rewards are now atomic (no double claims).
- Resources: downloads need login, count once per user; Pro links hidden from the public list; Pro auto-approve capped at 3/day.
- Mongo lookups by id/email/tokenHash are native queries; session TTL index now works (expiresAtDate).
- Stripe webhook can no longer crash the process; duplicate payments handled.
- Tutors can't re-enable admin-disabled listings; editing an approved listing sends it back to review.
- Reviewer emails hidden from tutors; DMs limited to student<->tutor; public tutor requests hide responses.
- Misc: bookmark limit ignores dead listings, profile PATCH keeps phone/bio, upload checks real file signature,
  duplicate signup/apply return 409, default avatars served from /api/assets, Next.js leftovers and stale lockfile removed.

Not changed: email verification at signup, review/bookmark read-modify-write races, in-memory OAuth state/rate limits,
local uploads/ folder (use S3/Cloudinary/ImgBB in production).
