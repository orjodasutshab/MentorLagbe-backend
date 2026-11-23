export type UserRole = 'student' | 'tutor' | 'admin';
export type UserPlan = 'free' | 'pro';
export type TuitionMode = 'Online' | 'Offline';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApplicationStatus = 'pending' | 'accepted' | 'rejected';

export interface TuitionReviewDoc {
  _id: string;
  studentName: string;
  studentEmail: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface UserDoc {
  _id: string;
  name: string;
  email: string;
  image: string;
  bannerImage?: string;
  facebookUrl?: string;
  youtubeUrl?: string;
  coins?: number;
  role: UserRole;
  phone: string;
  bio: string;
  plan: UserPlan;
  savedTuitionIds: string[];
  passwordHash?: string;
  claimedQuizIds?: string[];
  createdAt: string;
}

export interface TuitionDoc {
  _id: string;
  title: string;
  subject: string;
  classLevel: string;
  mode: TuitionMode;
  location: string;
  monthlyFee: number;
  daysPerWeek: number;
  bannerImage: string;
  description: string;
  tutorName: string;
  tutorEmail: string;
  tutorImage?: string;
  tutorPlan?: UserPlan;
  approvalStatus: ApprovalStatus;
  rejectionReason?: string;
  isActive: boolean;
  adminDisabled?: boolean;
  reviews: TuitionReviewDoc[];
  createdAt: string;
}

export interface ApplicationDoc {
  _id: string;
  tuitionId: string;
  tuitionTitle: string;
  subject: string;
  monthlyFee: number;
  tutorEmail: string;
  tutorName: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string;
  preferredSchedule: string;
  studentNote: string;
  status: ApplicationStatus;
  appliedAt: string;
}

export interface PaymentDoc {
  _id: string;
  userEmail: string;
  userName: string;
  userRole: UserRole;
  planName: string;
  amount: number;
  currency: string;
  transactionId: string;
  stripeSessionId: string;
  paymentStatus: 'paid';
  paidAt: string;
}

export interface AuthSessionDoc {
  _id: string;
  userId: string;
  userEmail: string;
  tokenHash: string;
  expiresAt: string;
  /** Real BSON Date copy of expiresAt — required for the MongoDB TTL index to work. */
  expiresAtDate?: Date;
  createdAt: string;
}

export interface ResourceDoc {
  _id: string;
  title: string;
  category: string;
  subject: string;
  classLevel: string;
  summary: string;
  contentPreview: string;
  thumbnailUrl: string;
  resourceUrl: string;
  accessLevel: 'free' | 'pro';
  authorId: string;
  authorName: string;
  authorEmail: string;
  approvalStatus: ApprovalStatus;
  approvalCoinCredited?: boolean;
  downloaderIds?: string[];
  downloads: number;
  createdAt: string;
}

export interface TutorRequestResponseDoc {
  _id: string;
  tutorId: string;
  tutorName: string;
  tutorImage: string;
  tutorPlan: UserPlan;
  proposedFee: number;
  pitch: string;
  createdAt: string;
}

export interface TutorRequestDoc {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  title: string;
  subject: string;
  classLevel: string;
  mode: TuitionMode;
  location: string;
  budgetMonthly: number;
  daysPerWeek: number;
  scheduleNote: string;
  description: string;
  status: 'open' | 'matched' | 'closed';
  responses: TutorRequestResponseDoc[];
  createdAt: string;
}

export interface MessageDoc {
  _id: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  senderImage: string;
  recipientId: string;
  recipientName: string;
  recipientRole: UserRole;
  recipientImage: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationDoc {
  _id: string;
  userEmail: string;
  title: string;
  message: string;
  type: 'application' | 'moderation' | 'message' | 'request' | 'system';
  link: string;
  read: boolean;
  createdAt: string;
}

export interface QuizAttemptDoc {
  _id: string;
  userId: string;
  userEmail: string;
  quizId: string;
  quizTitle: string;
  subject: string;
  score: number;
  total: number;
  percentage: number;
  coinsEarned?: number;
  passed?: boolean;
  writtenAnswers?: Record<string, string>;
  createdAt: string;
}

export interface CustomQuizQuestionDoc {
  id: string;
  type: 'mcq' | 'cq';
  prompt: string;
  options?: string[];
  correctIndex?: number;
  sampleAnswer?: string;
  keywords?: string[];
  explanation: string;
}

export interface CustomQuizDoc {
  _id: string;
  title: string;
  subject: string;
  level: string;
  durationMinutes: number;
  description: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  authorImage?: string;
  visibility: 'public' | 'private';
  shareCode: string;
  audience: 'all' | 'students' | 'tutors';
  approvalStatus: ApprovalStatus;
  rejectionReason?: string;
  rewardPerWinner: number;
  maxWinners: number;
  winnersCount: number;
  winnerUserIds: string[];
  rewardPoolTotal: number;
  rewardPoolRemaining: number;
  questions: CustomQuizQuestionDoc[];
  createdAt: string;
  updatedAt?: string;
}

export type DailyTrack = 'student' | 'tutor';

export interface DailyQuizProgressDoc {
  _id: string;
  userId: string;
  userEmail: string;
  track?: DailyTrack;
  completedLevel: number;
  lastCompletedDate: string;
  streak: number;
  totalXp: number;
  unlockedBadgeLevels: number[];
  updatedAt: string;
}

export interface DbSchema {
  users: UserDoc[];
  tuitions: TuitionDoc[];
  applications: ApplicationDoc[];
  payments: PaymentDoc[];
  auth_sessions: AuthSessionDoc[];
  resources: ResourceDoc[];
  tutor_requests: TutorRequestDoc[];
  messages: MessageDoc[];
  notifications: NotificationDoc[];
  quiz_attempts: QuizAttemptDoc[];
  custom_quizzes: CustomQuizDoc[];
  quiz_daily_progress: DailyQuizProgressDoc[];
}
