import type { DatabaseHandle } from '../db.ts';
import type {
  CustomQuizDoc,
  DailyQuizProgressDoc,
  MessageDoc,
  NotificationDoc,
  ResourceDoc,
  TutorRequestDoc,
} from '../types.ts';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function ensureExtrasSeeded(db: DatabaseHandle): Promise<void> {
  const [resCount, reqCount, msgCount, ntfCount, customQuizCount] = await Promise.all([
    db.resources.count(),
    db.tutor_requests.count(),
    db.messages.count(),
    db.notifications.count(),
    db.custom_quizzes.count(),
  ]);

  const demoUserDefaults: Array<{
    id: string;
    coins: number;
    facebookUrl?: string;
    youtubeUrl?: string;
  }> = [
    {
      id: 'usr_tutor_01',
      coins: 650,
      facebookUrl: 'https://facebook.com/mentorlagbe',
      youtubeUrl: 'https://youtube.com/@mentorlagbe',
    },
    {
      id: 'usr_tutor_02',
      coins: 320,
      facebookUrl: 'https://facebook.com/mentorlagbe',
    },
    {
      id: 'usr_tutor_03',
      coins: 520,
      youtubeUrl: 'https://youtube.com/@mentorlagbe',
    },
    { id: 'usr_student_01', coins: 120 },
    { id: 'usr_student_02', coins: 80 },
    { id: 'usr_admin_01', coins: 500 },
  ];

  for (const d of demoUserDefaults) {
    const existing = await db.users.findOne((u) => u._id === d.id);
    if (existing && typeof existing.coins !== 'number') {
      await db.users.updateOne(
        (u) => u._id === d.id,
        (u) => ({
          ...u,
          coins: d.coins,
          ...(u.facebookUrl === undefined && d.facebookUrl ? { facebookUrl: d.facebookUrl } : {}),
          ...(u.youtubeUrl === undefined && d.youtubeUrl ? { youtubeUrl: d.youtubeUrl } : {}),
        }),
      );
    }
  }

  if (resCount === 0) {
    const resources: ResourceDoc[] = [
      {
        _id: 'res_01',
        title: 'HSC Higher Math Calculus & Integration Formula Sheet',
        category: 'Formula Sheets',
        subject: 'Mathematics',
        classLevel: 'HSC / Class 11-12',
        summary: 'Complete differentiation, definite integral identities, and differential equation shortcuts for board & admission tests.',
        contentPreview:
          'Includes 42 standard integration templates, substitution patterns, area-under-curve worked examples, and 15 BUET/DU past-paper drill problems with step-by-step solutions.',
        thumbnailUrl: '/api/assets/default-banner.svg',
        resourceUrl: '/tuitions?subject=Mathematics',
        accessLevel: 'free',
        authorId: 'usr_tutor_01',
        authorName: 'Dr. Tanvir Ahmed',
        authorEmail: 'tutor@mentorlagbe.com',
        approvalStatus: 'approved',
        downloads: 418,
        createdAt: daysAgoIso(14),
      },
      {
        _id: 'res_02',
        title: 'Mechanics, Electrostatics & Optics Revision Pack',
        category: 'Lecture Notes',
        subject: 'Physics',
        classLevel: 'HSC / Class 11-12',
        summary: 'Visual vector diagrams, Gauss law derivations, and ray-optics sign conventions condensed into a single revision pack.',
        contentPreview:
          'Covers Newton laws in non-inertial frames, capacitor energy density proofs, interference fringe width problems, and a 20-minute pre-exam checklist.',
        thumbnailUrl: '/api/assets/default-banner.svg',
        resourceUrl: '/tuitions?subject=Physics',
        accessLevel: 'free',
        authorId: 'usr_tutor_01',
        authorName: 'Dr. Tanvir Ahmed',
        authorEmail: 'tutor@mentorlagbe.com',
        approvalStatus: 'approved',
        downloads: 309,
        createdAt: daysAgoIso(12),
      },
      {
        _id: 'res_03',
        title: 'IELTS Writing Task 2 Band 8.0 Essay Blueprint',
        category: 'Exam Guides',
        subject: 'IELTS',
        classLevel: 'IELTS / Admission',
        summary: 'Structured paragraphing templates, lexical cohesion banks, and examiner rubric checklists for Academic Writing.',
        contentPreview:
          'Contains 6 annotated Band 8.0+ sample essays across Opinion, Discussion, and Problem-Solution prompts with sentence-level coherence breakdowns.',
        thumbnailUrl: '/api/assets/default-banner.svg',
        resourceUrl: '/tuitions?subject=IELTS',
        accessLevel: 'free',
        authorId: 'usr_tutor_02',
        authorName: 'Nusrat Rahman',
        authorEmail: 'nusrat.tutor@mentorlagbe.com',
        approvalStatus: 'approved',
        downloads: 524,
        createdAt: daysAgoIso(10),
      },
      {
        _id: 'res_04',
        title: 'Python, SQL & HSC ICT Logic Gate Workbook',
        category: 'Coding Labs',
        subject: 'Programming',
        classLevel: 'HSC / University',
        summary: 'Boolean algebra simplification, SQL join drills, and Python recursion patterns for ICT & CS students.',
        contentPreview:
          'Walks through Karnaugh maps, truth-table to NAND gate conversion, SQL aggregation queries, and 12 timed Python problem-solving challenges.',
        thumbnailUrl: '/api/assets/default-banner.svg',
        resourceUrl: '/tuitions?subject=Programming',
        accessLevel: 'free',
        authorId: 'usr_tutor_03',
        authorName: 'Mahmudul Hasan',
        authorEmail: 'mahmud.tutor@mentorlagbe.com',
        approvalStatus: 'approved',
        downloads: 286,
        createdAt: daysAgoIso(8),
      },
      {
        _id: 'res_05',
        title: 'Organic Chemistry Reaction Mechanisms Map (Pro Pack)',
        category: 'Formula Sheets',
        subject: 'Chemistry',
        classLevel: 'HSC / Admission',
        summary: 'Color-coded SN1/SN2, electrophilic aromatic substitution, and reagent conversion pathways.',
        contentPreview:
          'High-yield conversion chart linking alkanes, alcohols, aldehydes, ketones, carboxylic acids, and amines with reagent conditions and exceptions.',
        thumbnailUrl: '/api/assets/default-banner.svg',
        resourceUrl: '/tuitions?subject=Chemistry',
        accessLevel: 'pro',
        authorId: 'usr_tutor_03',
        authorName: 'Mahmudul Hasan',
        authorEmail: 'mahmud.tutor@mentorlagbe.com',
        approvalStatus: 'approved',
        downloads: 192,
        createdAt: daysAgoIso(6),
      },
      {
        _id: 'res_06',
        title: 'Human Physiology & Genetics High-Yield Question Bank',
        category: 'Past Papers',
        subject: 'Biology',
        classLevel: 'HSC / Medical Prep',
        summary: 'Chapter-by-chapter MCQ bank covering cardiac cycle, nephron filtration, DNA replication, and Mendelian ratios.',
        contentPreview:
          'Includes 80 timed MCQs with physiological pathway explanations designed for HSC Board and Medical Admission prep.',
        thumbnailUrl: '/api/assets/default-banner.svg',
        resourceUrl: '/tuitions?subject=Biology',
        accessLevel: 'free',
        authorId: 'usr_tutor_01',
        authorName: 'Dr. Tanvir Ahmed',
        authorEmail: 'tutor@mentorlagbe.com',
        approvalStatus: 'approved',
        downloads: 241,
        createdAt: daysAgoIso(4),
      },
    ];
    for (const r of resources) {
      await db.resources.insertOne(r);
    }
  }

  if (reqCount === 0) {
    const requests: TutorRequestDoc[] = [
      {
        _id: 'treq_01',
        studentId: 'usr_student_01',
        studentName: 'Rafiul Islam',
        studentEmail: 'student@mentorlagbe.com',
        title: 'Need BUET-track Higher Math & Physics 1-on-1 Mentor',
        subject: 'Mathematics',
        classLevel: 'HSC / Class 11-12',
        mode: 'Online',
        location: 'Remote / Dhaka',
        budgetMonthly: 7500,
        daysPerWeek: 4,
        scheduleNote: 'Sun, Tue, Thu, Fri evenings (8:00 PM - 9:30 PM)',
        description:
          'Looking for structured problem-solving mentorship covering Conics, Calculus, and Mechanics with weekly timed mock reviews.',
        status: 'open',
        responses: [
          {
            _id: 'tresp_01',
            tutorId: 'usr_tutor_01',
            tutorName: 'Dr. Tanvir Ahmed',
            tutorImage: '/api/assets/default-avatar.svg',
            tutorPlan: 'pro',
            proposedFee: 7000,
            pitch:
              'I run a structured BUET admission & HSC Physics/Math track and have 8:00 PM slots open on Sun/Tue/Thu.',
            createdAt: daysAgoIso(2),
          },
        ],
        createdAt: daysAgoIso(5),
      },
      {
        _id: 'treq_02',
        studentId: 'usr_student_02',
        studentName: 'Sadia Afrin',
        studentEmail: 'sadia.student@mentorlagbe.com',
        title: 'IELTS Speaking & Academic Writing Intensive Tutor Needed',
        subject: 'IELTS',
        classLevel: 'IELTS / Admission',
        mode: 'Online',
        location: 'Remote',
        budgetMonthly: 6500,
        daysPerWeek: 3,
        scheduleNote: 'Flexible afternoons or Sat/Mon/Wed evenings',
        description:
          'Targeting Band 7.5+ overall within 8 weeks. Need graded Task 1/Task 2 feedback and 1-on-1 speaking mock interviews.',
        status: 'open',
        responses: [],
        createdAt: daysAgoIso(3),
      },
      {
        _id: 'treq_03',
        studentId: 'usr_student_01',
        studentName: 'Rafiul Islam',
        studentEmail: 'student@mentorlagbe.com',
        title: 'Home Tutor for HSC Chemistry (Organic & Quantitative)',
        subject: 'Chemistry',
        classLevel: 'HSC / Class 11-12',
        mode: 'Offline',
        location: 'Dhanmondi, Dhaka',
        budgetMonthly: 8000,
        daysPerWeek: 3,
        scheduleNote: 'Sat, Mon, Wed after 5:00 PM',
        description:
          'Need focused conceptual clarity in Organic reactions and volumetric titration numericals ahead of test exams.',
        status: 'open',
        responses: [],
        createdAt: daysAgoIso(2),
      },
    ];
    for (const tr of requests) {
      await db.tutor_requests.insertOne(tr);
    }
  }

  if (msgCount === 0) {
    const messages: MessageDoc[] = [
      {
        _id: 'msg_01',
        senderId: 'usr_student_01',
        senderName: 'Rafiul Islam',
        senderRole: 'student',
        senderImage: '/api/assets/default-avatar.svg',
        recipientId: 'usr_tutor_01',
        recipientName: 'Dr. Tanvir Ahmed',
        recipientRole: 'tutor',
        recipientImage: '/api/assets/default-avatar.svg',
        body: 'Assalamu Alaikum Sir, does your HSC Physics & Higher Math cohort include recorded problem-solving walkthroughs if I miss a live session?',
        read: true,
        createdAt: daysAgoIso(3),
      },
      {
        _id: 'msg_02',
        senderId: 'usr_tutor_01',
        senderName: 'Dr. Tanvir Ahmed',
        senderRole: 'tutor',
        senderImage: '/api/assets/default-avatar.svg',
        recipientId: 'usr_student_01',
        recipientName: 'Rafiul Islam',
        recipientRole: 'student',
        recipientImage: '/api/assets/default-avatar.svg',
        body: 'Yes, every live session comes with annotated PDF slides and worked problem sheets shared right after class.',
        read: false,
        createdAt: daysAgoIso(2),
      },
    ];
    for (const m of messages) {
      await db.messages.insertOne(m);
    }
  }

  if (ntfCount === 0) {
    const notifications: NotificationDoc[] = [
      {
        _id: 'ntf_01',
        userEmail: 'student@mentorlagbe.com',
        title: 'New reply from Dr. Tanvir Ahmed',
        message: 'Dr. Tanvir Ahmed replied to your message about HSC Physics & Higher Math.',
        type: 'message',
        link: '/dashboard/messages',
        read: false,
        createdAt: daysAgoIso(2),
      },
      {
        _id: 'ntf_02',
        userEmail: 'tutor@mentorlagbe.com',
        title: 'New student application received',
        message: 'Rafiul Islam applied to your HSC Physics Mechanics & Calculus cohort.',
        type: 'application',
        link: '/dashboard/tutor/applicants',
        read: false,
        createdAt: daysAgoIso(1),
      },
    ];
    for (const n of notifications) {
      await db.notifications.insertOne(n);
    }
  }

  const seedTutorDailyProgress: DailyQuizProgressDoc[] = [
    {
      _id: 'dqp_seed_tutor_01',
      userId: 'usr_tutor_01',
      userEmail: 'tutor@mentorlagbe.com',
      track: 'tutor',
      completedLevel: 50,
      lastCompletedDate: daysAgoIso(1).slice(0, 10),
      streak: 14,
      totalXp: 3250,
      unlockedBadgeLevels: [1, 3, 5, 8, 10, 15, 25, 50],
      updatedAt: daysAgoIso(1),
    },
    {
      _id: 'dqp_seed_tutor_02',
      userId: 'usr_tutor_02',
      userEmail: 'nusrat.tutor@mentorlagbe.com',
      track: 'tutor',
      completedLevel: 15,
      lastCompletedDate: daysAgoIso(2).slice(0, 10),
      streak: 6,
      totalXp: 940,
      unlockedBadgeLevels: [1, 3, 5, 10, 15],
      updatedAt: daysAgoIso(2),
    },
    {
      _id: 'dqp_seed_tutor_03',
      userId: 'usr_tutor_03',
      userEmail: 'mahmud.tutor@mentorlagbe.com',
      track: 'tutor',
      completedLevel: 30,
      lastCompletedDate: daysAgoIso(1).slice(0, 10),
      streak: 9,
      totalXp: 1920,
      unlockedBadgeLevels: [1, 3, 5, 8, 10, 15, 20, 25, 30],
      updatedAt: daysAgoIso(1),
    },
  ];

  for (const progress of seedTutorDailyProgress) {
    const [existingUser, existingProgress] = await Promise.all([
      db.users.findOne((u) => u._id === progress.userId),
      db.quiz_daily_progress.findOne((p) => p.userId === progress.userId),
    ]);
    if (existingUser && !existingProgress) {
      await db.quiz_daily_progress.insertOne(progress);
    }
  }

  if (customQuizCount === 0) {
    const seededQuizzes: CustomQuizDoc[] = [
      {
        _id: 'cqz_seed_01',
        title: 'HSC Calculus & Vectors Coin Sprint',
        subject: 'Mathematics',
        level: 'HSC / Admission',
        durationMinutes: 10,
        description:
          'Solve 2 MCQs and 1 short written CQ problem accurately to win 10 coins from Dr. Tanvir Ahmed’s 500-coin prize pool.',
        authorId: 'usr_tutor_01',
        authorName: 'Dr. Tanvir Ahmed',
        authorEmail: 'tutor@mentorlagbe.com',
        authorImage: '/api/assets/default-avatar.svg',
        visibility: 'public',
        shareCode: 'MLQ-MATH500',
        audience: 'all',
        approvalStatus: 'approved',
        rewardPerWinner: 10,
        maxWinners: 50,
        winnersCount: 0,
        winnerUserIds: [],
        rewardPoolTotal: 500,
        rewardPoolRemaining: 500,
        questions: [
          {
            id: 'q1',
            type: 'mcq',
            prompt: 'What is the derivative of sin(3x) with respect to x?',
            options: ['3cos(3x)', 'cos(3x)', '-3cos(3x)', '(1/3)cos(3x)'],
            correctIndex: 0,
            explanation: 'By the chain rule, d/dx[sin(3x)] = cos(3x) * 3 = 3cos(3x).',
          },
          {
            id: 'q2',
            type: 'mcq',
            prompt: 'Two vectors A and B are perpendicular when their dot product A·B equals:',
            options: ['1', '0', '|A||B|', '-1'],
            correctIndex: 1,
            explanation: 'Since A·B = |A||B|cos(90°) = 0, perpendicular vectors have zero dot product.',
          },
          {
            id: 'q3',
            type: 'cq',
            prompt: 'CQ: Find the value of the definite integral ∫₀² 3x² dx (write the final number or brief step).',
            sampleAnswer: '8',
            keywords: ['8'],
            explanation: 'The antiderivative of 3x² is x³. Evaluating from 0 to 2 gives 2³ - 0³ = 8.',
          },
        ],
        createdAt: daysAgoIso(3),
      },
      {
        _id: 'cqz_seed_02',
        title: 'IELTS Band 8 Grammar & Sentence Precision Challenge',
        subject: 'IELTS',
        level: 'Band 7.0 - 8.5',
        durationMinutes: 8,
        description:
          'Student-only mastery check combining Academic IELTS MCQs and a concise written synthesis question.',
        authorId: 'usr_tutor_02',
        authorName: 'Nusrat Rahman',
        authorEmail: 'nusrat.tutor@mentorlagbe.com',
        authorImage: '/api/assets/default-avatar.svg',
        visibility: 'public',
        shareCode: 'MLQ-IELTS300',
        audience: 'students',
        approvalStatus: 'approved',
        rewardPerWinner: 15,
        maxWinners: 20,
        winnersCount: 0,
        winnerUserIds: [],
        rewardPoolTotal: 300,
        rewardPoolRemaining: 300,
        questions: [
          {
            id: 'q1',
            type: 'mcq',
            prompt: 'Which linker expresses concession cleanly in an IELTS Task 2 essay?',
            options: ['Nevertheless', 'Therefore', 'Namely', 'Moreover'],
            correctIndex: 0,
            explanation: '"Nevertheless" introduces a contrasting concession to the previous point.',
          },
          {
            id: 'q2',
            type: 'mcq',
            prompt: 'Choose the grammatically accurate Academic Task 1 phrase:',
            options: [
              'Sales witnessed a sharp rose in 2024.',
              'Sales experienced a sharp rise in 2024.',
              'Sales were rise sharply in 2024.',
              'Sales peaked down in 2024.',
            ],
            correctIndex: 1,
            explanation: '"Experienced a sharp rise" uses the noun form "rise" accurately.',
          },
          {
            id: 'q3',
            type: 'cq',
            prompt: 'CQ: Name the IELTS Writing criterion that evaluates linking words, paragraphing, and logical flow.',
            sampleAnswer: 'Coherence and Cohesion',
            keywords: ['coherence', 'cohesion'],
            explanation: 'IELTS Writing assesses Task Achievement/Response, Coherence and Cohesion, Lexical Resource, and Grammatical Range.',
          },
        ],
        createdAt: daysAgoIso(2),
      },
      {
        _id: 'cqz_seed_03',
        title: 'Tutor Mastery: Python Complexity & SQL Design Check',
        subject: 'Programming',
        level: 'Tutor Benchmark',
        durationMinutes: 8,
        description:
          'Exclusive peer challenge for verified tutors covering algorithmic complexity and relational query design.',
        authorId: 'usr_tutor_03',
        authorName: 'Mahmudul Hasan',
        authorEmail: 'mahmud.tutor@mentorlagbe.com',
        authorImage: '/api/assets/default-avatar.svg',
        visibility: 'public',
        shareCode: 'MLQ-TUTOR300',
        audience: 'tutors',
        approvalStatus: 'approved',
        rewardPerWinner: 20,
        maxWinners: 15,
        winnersCount: 0,
        winnerUserIds: [],
        rewardPoolTotal: 300,
        rewardPoolRemaining: 300,
        questions: [
          {
            id: 'q1',
            type: 'mcq',
            prompt: 'What is the worst-case time complexity of binary search on a sorted array of n items?',
            options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
            correctIndex: 1,
            explanation: 'Binary search halves the search space at each step, running in O(log n) worst-case time.',
          },
          {
            id: 'q2',
            type: 'cq',
            prompt: 'CQ: Which SQL keyword eliminates duplicate rows from a SELECT result set?',
            sampleAnswer: 'DISTINCT',
            keywords: ['distinct'],
            explanation: 'SELECT DISTINCT filters duplicate result rows.',
          },
        ],
        createdAt: daysAgoIso(1),
      },
    ];
    for (const q of seededQuizzes) {
      await db.custom_quizzes.insertOne(q);
    }
  }
}
