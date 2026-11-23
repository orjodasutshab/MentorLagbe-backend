import type { DailyTrack } from '../types.ts';

export const TOTAL_DAILY_LEVELS = 1000;
export const DAILY_PASSING_SCORE = 3;
export const DAILY_QUESTIONS_PER_LEVEL = 5;

export const BADGE_MILESTONE_LEVELS: readonly number[] = [
  1, 3, 5, 8, 10, 13, 15, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 85, 95,
  100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 240, 250, 265, 280, 295, 300, 320,
  350, 380, 400, 430, 440, 450, 470, 480, 500, 520, 525, 540, 550, 560, 570, 580, 590, 600, 610, 620,
  630, 670, 680, 690, 700, 705, 710, 715, 720, 725, 730, 740, 750, 760, 780, 800, 810, 820, 830, 840,
  850, 860, 870, 880, 890, 900, 905, 907, 910, 920, 930, 940, 950, 990, 1000,
] as const;

const BADGE_MILESTONE_SET = new Set<number>(BADGE_MILESTONE_LEVELS);

export type BadgeTier =
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Emerald'
  | 'Diamond'
  | 'Grandmaster';

export interface DailyBadgeDef {
  id: string;
  track: DailyTrack;
  level: number;
  name: string;
  tier: BadgeTier;
  description: string;
}

export interface DailyQuestionDef {
  id: string;
  subject: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface DailyLevelQuizDef {
  level: number;
  track: DailyTrack;
  trackLabel: string;
  tierName: string;
  title: string;
  subjectMix: string;
  passingScore: number;
  xpReward: number;
  badge: DailyBadgeDef | null;
  questions: DailyQuestionDef[];
}

export function resolveDailyTrack(roleOrTrack?: string | null): DailyTrack {
  return roleOrTrack === 'tutor' ? 'tutor' : 'student';
}

const STUDENT_SPECIAL_BADGE_TITLES: Record<number, string> = {
  1: 'Freshman Spark',
  3: 'Curiosity Seeker',
  5: 'Five-Day Learner',
  8: 'Study Sprinter',
  10: 'Honor Roll Novice',
  13: 'Concept Explorer',
  15: 'Fortnight Scholar',
  18: 'Quiz Challenger',
  20: 'Consistent Student',
  25: 'Quarter-Century Cadet',
  30: 'Monthly Achiever',
  50: 'Half-Century Prodigy',
  100: 'Centurion Scholar',
  150: 'Analytical Ace',
  200: "Dean's List Star",
  250: 'Quarter-Millennium Scholar',
  300: 'Tri-Century Trailblazer',
  400: 'Board Exam Strategist',
  500: 'Half-Summit Champion',
  600: 'Merit Honor Luminary',
  700: 'Olympiad Contender',
  750: 'Three-Quarter Titan',
  800: 'Academic Virtuoso',
  900: 'Valedictorian Vanguard',
  907: 'Hidden Summit Seeker',
  950: 'Admission Finalist',
  990: 'Threshold Legend',
  1000: 'Student Grandmaster 1000',
};

const TUTOR_SPECIAL_BADGE_TITLES: Record<number, string> = {
  1: 'First Class Mentor',
  3: 'Classroom Catalyst',
  5: 'Five-Day Educator',
  8: 'Syllabus Architect',
  10: 'Decade Pedagogue',
  13: 'Clarity Artisan',
  15: 'Fortnight Instructor',
  18: 'Concept Strategist',
  20: 'Dedicated Coach',
  25: 'Quarter-Century Guide',
  30: 'Mastery Facilitator',
  50: 'Half-Century Mentor',
  100: 'Centurion Educator',
  150: 'Socratic Maestro',
  200: 'Bicentennial Professor',
  250: 'Quarter-Millennium Dean',
  300: 'Tri-Century Mentor',
  400: 'Curriculum Tactician',
  500: 'Half-Summit Fellow',
  600: 'Faculty Luminary',
  700: 'Seven-Hundred Sage',
  750: 'Principal Scholar',
  800: 'Octa-Century Maestro',
  900: 'Provost Vanguard',
  907: 'Mentorship Summit Keeper',
  950: 'Grand Educator',
  990: 'Chancellor Legend',
  1000: 'Master Tutor 1000',
};

const STUDENT_RANK_TITLES = [
  'Learner',
  'Explorer',
  'Scholar',
  'Contender',
  'Merit Track',
  'Honors Student',
  'Olympiad',
  'Senior Fellow',
  'Valedictorian',
  'Grandmaster',
];

const TUTOR_RANK_TITLES = [
  'Instructor',
  'Coach',
  'Educator',
  'Mentor',
  'Pedagogue',
  'Senior Lecturer',
  'Faculty Fellow',
  'Master Tutor',
  'Dean Track',
  'Grand Provost',
];

export function getBadgeTier(level: number): BadgeTier {
  if (level <= 45) return 'Bronze';
  if (level <= 150) return 'Silver';
  if (level <= 350) return 'Gold';
  if (level <= 550) return 'Platinum';
  if (level <= 750) return 'Emerald';
  if (level <= 920) return 'Diamond';
  return 'Grandmaster';
}

export function getBadgeForLevel(level: number, track: DailyTrack = 'student'): DailyBadgeDef | null {
  if (!BADGE_MILESTONE_SET.has(level)) return null;
  const tier = getBadgeTier(level);
  const rankIdx = Math.min(9, Math.floor((level - 1) / 100));
  const specialMap = track === 'tutor' ? TUTOR_SPECIAL_BADGE_TITLES : STUDENT_SPECIAL_BADGE_TITLES;
  const rankTitles = track === 'tutor' ? TUTOR_RANK_TITLES : STUDENT_RANK_TITLES;
  const customName = specialMap[level];
  const name = customName || `${rankTitles[rankIdx]} Milestone ${level}`;
  const trackWord = track === 'tutor' ? 'Tutor' : 'Student';
  return {
    id: `badge_${track}_lvl_${level}`,
    track,
    level,
    name,
    tier,
    description: `${trackWord} Track: Earned by passing Level ${level} in the ${trackWord} 1,000-Level Daily Challenge.`,
  };
}

export const STUDENT_MILESTONE_BADGES: DailyBadgeDef[] = BADGE_MILESTONE_LEVELS.map(
  (level) => getBadgeForLevel(level, 'student')!,
);

export const TUTOR_MILESTONE_BADGES: DailyBadgeDef[] = BADGE_MILESTONE_LEVELS.map(
  (level) => getBadgeForLevel(level, 'tutor')!,
);

export function getAllMilestoneBadges(track: DailyTrack = 'student'): DailyBadgeDef[] {
  return track === 'tutor' ? TUTOR_MILESTONE_BADGES : STUDENT_MILESTONE_BADGES;
}

export const ALL_MILESTONE_BADGES: DailyBadgeDef[] = STUDENT_MILESTONE_BADGES;

export function getDhakaDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getPreviousDhakaDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString().slice(0, 10);
}

function createRng(seed: number): () => number {
  let state = (seed * 2654435761 + 1013904223) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function buildOptions(
  correct: string,
  candidates: string[],
  rng: () => number,
): { options: string[]; correctIndex: number } {
  const uniqueDistractors: string[] = [];
  for (const c of candidates) {
    if (c !== correct && !uniqueDistractors.includes(c)) {
      uniqueDistractors.push(c);
    }
    if (uniqueDistractors.length === 3) break;
  }
  let suffix = 1;
  while (uniqueDistractors.length < 3) {
    const numeric = Number(correct);
    const candidate = Number.isFinite(numeric)
      ? String(numeric + suffix * (suffix % 2 === 0 ? 2 : -1))
      : `${correct} (${suffix})`;
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
    correctIndex: options.indexOf(correct),
  };
}

function getTierName(level: number, track: DailyTrack): string {
  if (track === 'tutor') {
    if (level <= 100) return 'Mentor Foundation (Levels 1–100)';
    if (level <= 250) return 'Pedagogy & Concept Depth (Levels 101–250)';
    if (level <= 500) return 'Senior Lecturer Track (Levels 251–500)';
    if (level <= 750) return 'Faculty Honors Mastery (Levels 501–750)';
    if (level <= 900) return 'Olympiad Coaching Sprint (Levels 751–900)';
    return 'Provost Grandmaster Ascent (Levels 901–1000)';
  }
  if (level <= 100) return 'Foundation Stage (Levels 1–100)';
  if (level <= 250) return 'Core Builder (Levels 101–250)';
  if (level <= 500) return 'Analytical Track (Levels 251–500)';
  if (level <= 750) return 'Honors Mastery (Levels 501–750)';
  if (level <= 900) return 'Olympiad Sprint (Levels 751–900)';
  return 'Grandmaster Ascent (Levels 901–1000)';
}

interface ConceptEntry {
  prompt: string;
  correct: string;
  distractors: [string, string, string];
  explanation: string;
}

// ============================================================================
// STUDENT TRACK QUESTION GENERATORS (Diverse across 7 curriculum domains)
// ============================================================================

function generateStudentMath(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level * 3 + randInt(rng, 0, 7)) % 8;

  if (variant === 0) {
    const a = randInt(rng, 2, 6 + Math.floor(level / 140));
    const x = randInt(rng, 2, 12 + Math.floor(level / 90));
    const b = randInt(rng, 3, 24);
    const c = a * x + b;
    const { options, correctIndex } = buildOptions(
      String(x),
      [String(x + 1), String(x - 1), String(x + 2), String(Math.max(1, x - 2))],
      rng,
    );
    return {
      id: slotId,
      subject: 'Mathematics',
      prompt: `Solve for x: ${a}x + ${b} = ${c}`,
      options,
      correctIndex,
      explanation: `Subtract ${b} to get ${a}x = ${c - b}, then divide by ${a} so x = ${x}.`,
    };
  }

  if (variant === 1) {
    const a1 = randInt(rng, 2, 14);
    const d = randInt(rng, 3, 9 + Math.floor(level / 160));
    const n = randInt(rng, 5, 14);
    const ans = a1 + (n - 1) * d;
    const { options, correctIndex } = buildOptions(
      String(ans),
      [String(ans + d), String(ans - d), String(a1 + n * d), String(ans + 2)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Mathematics',
      prompt: `Find the ${n}th term of the arithmetic sequence starting at ${a1} with common difference ${d}.`,
      options,
      correctIndex,
      explanation: `Tₙ = a + (n − 1)d = ${a1} + (${n} − 1) × ${d} = ${ans}.`,
    };
  }

  if (variant === 2) {
    const r1 = randInt(rng, 2, 9);
    const r2 = randInt(rng, r1 + 1, 14);
    const sum = r1 + r2;
    const prod = r1 * r2;
    const { options, correctIndex } = buildOptions(
      String(prod),
      [String(sum), String(prod + r1), String(Math.max(2, prod - r2)), String(r1 * r1 + r2)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Mathematics',
      prompt: `If the roots of x² − ${sum}x + k = 0 are ${r1} and ${r2}, what is k?`,
      options,
      correctIndex,
      explanation: `By Vieta's formula, k = product of roots = ${r1} × ${r2} = ${prod}.`,
    };
  }

  if (variant === 3) {
    const pct = pick(rng, [10, 15, 20, 25, 30, 40] as const);
    const base = randInt(rng, 4, 18) * 20;
    const ans = (base * pct) / 100;
    const { options, correctIndex } = buildOptions(
      String(ans),
      [String(ans + 10), String(Math.max(5, ans - 10)), String(base - ans), String(ans * 2)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Mathematics',
      prompt: `A textbook priced at ৳${base} gets a ${pct}% student discount. How much money is saved?`,
      options,
      correctIndex,
      explanation: `${pct}% of ${base} = (${pct} / 100) × ${base} = ${ans}.`,
    };
  }

  if (variant === 4) {
    const dx = pick(rng, [3, 5, 6, 8, 9] as const);
    const dy = dx === 3 ? 4 : dx === 5 ? 12 : dx === 6 ? 8 : dx === 8 ? 15 : 12;
    const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
    const x1 = randInt(rng, 1, 5);
    const y1 = randInt(rng, 1, 5);
    const { options, correctIndex } = buildOptions(
      String(dist),
      [String(dx + dy), String(dist + 2), String(Math.max(1, dist - 1)), String(dy)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Mathematics',
      prompt: `Find the Euclidean distance between points A(${x1}, ${y1}) and B(${x1 + dx}, ${y1 + dy}).`,
      options,
      correctIndex,
      explanation: `Distance = √(${dx}² + ${dy}²) = √(${dx * dx + dy * dy}) = ${dist}.`,
    };
  }

  if (variant === 5) {
    const a = randInt(rng, 2, 7);
    const b = randInt(rng, 2, 11);
    const xVal = randInt(rng, 1, 4);
    const ans = 2 * a * xVal + b;
    const { options, correctIndex } = buildOptions(
      String(ans),
      [String(a * xVal + b), String(2 * a * xVal), String(ans + a), String(Math.max(1, ans - b))],
      rng,
    );
    return {
      id: slotId,
      subject: 'Mathematics',
      prompt: `Given f(x) = ${a}x² + ${b}x + 5, compute the derivative f'(${xVal}).`,
      options,
      correctIndex,
      explanation: `f'(x) = ${2 * a}x + ${b}, so f'(${xVal}) = ${2 * a}(${xVal}) + ${b} = ${ans}.`,
    };
  }

  if (variant === 6) {
    const base = pick(rng, [2, 3, 5] as const);
    const exp = randInt(rng, 2, 5);
    const val = Math.pow(base, exp);
    const { options, correctIndex } = buildOptions(
      String(exp),
      [String(exp + 1), String(Math.max(1, exp - 1)), String(base), String(exp + 2)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Mathematics',
      prompt: `Evaluate the logarithm: log_${base}(${val}) = ?`,
      options,
      correctIndex,
      explanation: `Since ${base}^${exp} = ${val}, log_${base}(${val}) = ${exp}.`,
    };
  }

  const n = randInt(rng, 5, 8);
  const k = 2;
  const comb = (n * (n - 1)) / 2;
  const { options, correctIndex } = buildOptions(
    String(comb),
    [String(n * (n - 1)), String(comb + n), String(Math.max(3, comb - 3)), String(n * k)],
    rng,
  );
  return {
    id: slotId,
    subject: 'Mathematics',
    prompt: `In how many ways can a study group choose ${k} team captains out of ${n} students?`,
    options,
    correctIndex,
    explanation: `C(${n}, 2) = ${n} × (${n} − 1) / 2 = ${comb}.`,
  };
}

const STUDENT_PHYSICS_CONCEPTS: readonly ConceptEntry[] = [
  {
    prompt: 'Which SI unit measures electrical resistance?',
    correct: 'Ohm (Ω)',
    distractors: ['Watt (W)', 'Coulomb (C)', 'Tesla (T)'],
    explanation: 'Electrical resistance R = V / I is measured in Ohms (Ω).',
  },
  {
    prompt: 'When light passes from air into glass, its frequency:',
    correct: 'Remains constant while wavelength decreases',
    distractors: [
      'Doubles while speed stays constant',
      'Drops to zero at the boundary',
      'Increases along with its speed',
    ],
    explanation: 'Frequency is fixed by the source; speed and wavelength decrease in a denser medium.',
  },
  {
    prompt: 'Which law explains why passengers lurch forward when a bus brakes suddenly?',
    correct: "Newton's First Law (Inertia)",
    distractors: ["Pascal's Principle", "Archimedes' Principle", "Hooke's Law"],
    explanation: 'Inertia keeps the body moving forward at constant velocity unless an external force acts.',
  },
  {
    prompt: 'In a vacuum, which electromagnetic wave has the shortest wavelength?',
    correct: 'Gamma rays',
    distractors: ['Microwaves', 'Infrared waves', 'Visible red light'],
    explanation: 'Gamma rays carry the highest frequency and shortest wavelength in the EM spectrum.',
  },
];

function generateStudentPhysics(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level * 5 + randInt(rng, 0, 5)) % 6;

  if (variant === 0) {
    const u = randInt(rng, 2, 12);
    const a = randInt(rng, 2, 6);
    const t = randInt(rng, 3, 9);
    const v = u + a * t;
    const { options, correctIndex } = buildOptions(
      `${v} m/s`,
      [`${u + a + t} m/s`, `${v + a} m/s`, `${Math.max(1, v - t)} m/s`, `${a * t} m/s`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Physics',
      prompt: `A cyclist starts at ${u} m/s and accelerates at ${a} m/s² for ${t} s. Find the final speed.`,
      options,
      correctIndex,
      explanation: `v = u + at = ${u} + ${a} × ${t} = ${v} m/s.`,
    };
  }

  if (variant === 1) {
    const m = randInt(rng, 2, 10);
    const v = randInt(rng, 2, 6) * 2;
    const ke = 0.5 * m * v * v;
    const { options, correctIndex } = buildOptions(
      `${ke} J`,
      [`${m * v} J`, `${m * v * v} J`, `${ke + m * v} J`, `${Math.max(4, ke / 2)} J`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Physics',
      prompt: `What is the kinetic energy of a ${m} kg ball moving at ${v} m/s?`,
      options,
      correctIndex,
      explanation: `KE = ½mv² = 0.5 × ${m} × ${v}² = ${ke} J.`,
    };
  }

  if (variant === 2) {
    const i = randInt(rng, 2, 8);
    const r = randInt(rng, 3, 14);
    const v = i * r;
    const { options, correctIndex } = buildOptions(
      `${v} V`,
      [`${i + r} V`, `${v + r} V`, `${Math.max(2, v - i)} V`, `${r} V`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Physics',
      prompt: `A ${r} Ω lamp carries a current of ${i} A. What voltage drops across it?`,
      options,
      correctIndex,
      explanation: `Ohm's Law: V = I × R = ${i} × ${r} = ${v} V.`,
    };
  }

  if (variant === 3) {
    const f = randInt(rng, 10, 50);
    const lam = randInt(rng, 2, 7);
    const speed = f * lam;
    const { options, correctIndex } = buildOptions(
      `${speed} m/s`,
      [`${f + lam} m/s`, `${speed + f} m/s`, `${Math.round(f / lam)} m/s`, `${speed * 2} m/s`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Physics',
      prompt: `A sound wave has frequency ${f} Hz and wavelength ${lam} m. Calculate its speed.`,
      options,
      correctIndex,
      explanation: `v = fλ = ${f} × ${lam} = ${speed} m/s.`,
    };
  }

  if (variant === 4) {
    const work = randInt(rng, 4, 15) * 30;
    const time = pick(rng, [3, 5, 6, 10] as const);
    const power = work / time;
    const { options, correctIndex } = buildOptions(
      `${power} W`,
      [`${work * time} W`, `${power + 15} W`, `${Math.max(5, power - 10)} W`, `${work} W`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Physics',
      prompt: `A motor performs ${work} J of work in ${time} seconds. What is its average power output?`,
      options,
      correctIndex,
      explanation: `Power P = W / t = ${work} / ${time} = ${power} W.`,
    };
  }

  const fact = STUDENT_PHYSICS_CONCEPTS[(level - 1) % STUDENT_PHYSICS_CONCEPTS.length];
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: 'Physics',
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation,
  };
}

const STUDENT_CHEM_CONCEPTS: readonly ConceptEntry[] = [
  {
    prompt: 'Which gas law states pressure and volume vary inversely at constant temperature?',
    correct: "Boyle's Law",
    distractors: ["Charles's Law", "Avogadro's Law", "Dalton's Law"],
    explanation: "Boyle's Law states P₁V₁ = P₂V₂ when temperature and moles stay fixed.",
  },
  {
    prompt: 'What type of bond forms by sharing electron pairs between non-metals?',
    correct: 'Covalent bond',
    distractors: ['Ionic bond', 'Metallic bond', 'Van der Waals force'],
    explanation: 'Non-metal atoms achieve stable octets by sharing valence electron pairs.',
  },
  {
    prompt: 'Which subatomic particle determines the atomic number of an element?',
    correct: 'Proton',
    distractors: ['Neutron', 'Electron', 'Alpha particle'],
    explanation: 'Atomic number Z equals the number of protons inside the atomic nucleus.',
  },
  {
    prompt: 'What is the hybridization of the carbon atom in methane (CH₄)?',
    correct: 'sp³',
    distractors: ['sp', 'sp²', 'sp³d'],
    explanation: 'Carbon in CH₄ forms four single sigma bonds in a tetrahedral sp³ arrangement.',
  },
  {
    prompt: 'Which halogen exists as a liquid at standard room temperature?',
    correct: 'Bromine (Br₂)',
    distractors: ['Fluorine (F₂)', 'Chlorine (Cl₂)', 'Iodine (I₂)'],
    explanation: 'Bromine is the only non-metal liquid at 25°C and 1 atm.',
  },
  {
    prompt: 'During oxidation in a chemical reaction, a species:',
    correct: 'Loses electrons',
    distractors: ['Gains electrons', 'Loses protons', 'Decreases oxidation number'],
    explanation: 'OIL RIG: Oxidation Is Loss of electrons (increasing oxidation state).',
  },
];

function generateStudentChemistry(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level * 7 + randInt(rng, 0, 3)) % 4;

  if (variant === 0) {
    const moles = randInt(rng, 2, 9);
    const liters = pick(rng, [1, 2, 4] as const);
    const m = moles / liters;
    const formatted = Number.isInteger(m) ? `${m} M` : `${m.toFixed(2)} M`;
    const { options, correctIndex } = buildOptions(
      formatted,
      [`${moles + liters} M`, `${(m + 1).toFixed(Number.isInteger(m) ? 0 : 2)} M`, `${(m * 2).toFixed(Number.isInteger(m) ? 0 : 2)} M`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Chemistry',
      prompt: `Find the molarity when ${moles} moles of NaCl are dissolved in ${liters} L of solution.`,
      options,
      correctIndex,
      explanation: `Molarity = moles / liters = ${moles} / ${liters} = ${formatted}.`,
    };
  }

  if (variant === 1) {
    const exp = randInt(rng, 1, 6);
    const { options, correctIndex } = buildOptions(
      String(exp),
      [String(exp + 1), String(14 - exp), String(exp + 2), '7'],
      rng,
    );
    return {
      id: slotId,
      subject: 'Chemistry',
      prompt: `An acidic solution has [H⁺] = 10⁻${exp} mol/L at 25°C. What is its pH?`,
      options,
      correctIndex,
      explanation: `pH = −log₁₀[H⁺] = −log₁₀(10⁻${exp}) = ${exp}.`,
    };
  }

  if (variant === 2) {
    const compounds = [
      { formula: 'H₂O', mass: 18, detail: '2(1) + 16 = 18' },
      { formula: 'CO₂', mass: 44, detail: '12 + 2(16) = 44' },
      { formula: 'CH₄', mass: 16, detail: '12 + 4(1) = 16' },
      { formula: 'NH₃', mass: 17, detail: '14 + 3(1) = 17' },
      { formula: 'NaOH', mass: 40, detail: '23 + 16 + 1 = 40' },
      { formula: 'CaCO₃', mass: 100, detail: '40 + 12 + 3(16) = 100' },
    ];
    const chosen = compounds[(level + randInt(rng, 0, compounds.length - 1)) % compounds.length];
    const moles = randInt(rng, 2, 4);
    const totalMass = chosen.mass * moles;
    const { options, correctIndex } = buildOptions(
      `${totalMass} g`,
      [`${chosen.mass} g`, `${totalMass + chosen.mass} g`, `${totalMass - 8} g`, `${chosen.mass + moles} g`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Chemistry',
      prompt: `What is the mass in grams of ${moles} moles of ${chosen.formula}?`,
      options,
      correctIndex,
      explanation: `Molar mass of ${chosen.formula} is ${chosen.detail} g/mol. ${moles} mol × ${chosen.mass} g/mol = ${totalMass} g.`,
    };
  }

  const fact = STUDENT_CHEM_CONCEPTS[(level - 1) % STUDENT_CHEM_CONCEPTS.length];
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: 'Chemistry',
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation,
  };
}

const STUDENT_BIOLOGY_BANK: readonly ConceptEntry[] = [
  {
    prompt: 'Which organelle synthesizes most of the cell’s ATP via aerobic respiration?',
    correct: 'Mitochondrion',
    distractors: ['Golgi apparatus', 'Lysosome', 'Ribosome'],
    explanation: 'Mitochondria carry out the Krebs cycle and oxidative phosphorylation to generate ATP.',
  },
  {
    prompt: 'In DNA, which nitrogenous base pairs exclusively with Cytosine (C)?',
    correct: 'Guanine (G)',
    distractors: ['Adenine (A)', 'Thymine (T)', 'Uracil (U)'],
    explanation: 'Chargaff’s base-pairing rule pairs G with C via three hydrogen bonds and A with T via two.',
  },
  {
    prompt: 'Which hormone lowers blood glucose levels by promoting cellular glucose uptake?',
    correct: 'Insulin',
    distractors: ['Glucagon', 'Adrenaline', 'Thyroxine'],
    explanation: 'Pancreatic beta cells secrete insulin to move glucose from blood into muscle and liver cells.',
  },
  {
    prompt: 'What is the functional filtration unit inside each human kidney?',
    correct: 'Nephron',
    distractors: ['Alveolus', 'Neuron', 'Sarcomere'],
    explanation: 'Millions of nephrons filter blood plasma, reabsorb nutrients, and produce urine.',
  },
  {
    prompt: 'During photosynthesis, oxygen gas (O₂) is released from the splitting of:',
    correct: 'Water (H₂O)',
    distractors: ['Carbon dioxide (CO₂)', 'Glucose (C₆H₁₂O₆)', 'Chlorophyll'],
    explanation: 'Photolysis of water during the light-dependent reactions produces electrons, H⁺, and O₂.',
  },
  {
    prompt: 'Which plant vascular tissue transports dissolved sugars from leaves to roots?',
    correct: 'Phloem',
    distractors: ['Xylem', 'Cambium', 'Epidermis'],
    explanation: 'Phloem carries sucrose and nutrients bidirectionally; xylem conducts water upward.',
  },
  {
    prompt: 'Mitosis produces two daughter cells that are:',
    correct: 'Genetically identical and diploid (2n)',
    distractors: [
      'Genetically unique and haploid (n)',
      'Four gametes with half the DNA',
      'Devoid of nuclear membranes',
    ],
    explanation: 'Mitosis preserves chromosome number (2n → 2n) for growth and tissue repair.',
  },
  {
    prompt: 'Which blood cells are primarily responsible for carrying oxygen via hemoglobin?',
    correct: 'Red blood cells (Erythrocytes)',
    distractors: ['White blood cells (Leukocytes)', 'Platelets', 'Plasma proteins'],
    explanation: 'Erythrocytes are packed with iron-rich hemoglobin molecules that bind O₂.',
  },
];

function generateStudentBiology(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const item = STUDENT_BIOLOGY_BANK[(level - 1) % STUDENT_BIOLOGY_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: 'Biology',
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation,
  };
}

const STUDENT_ICT_CONCEPTS: readonly ConceptEntry[] = [
  {
    prompt: 'What is the worst-case time complexity of Binary Search on a sorted list of n items?',
    correct: 'O(log n)',
    distractors: ['O(1)', 'O(n)', 'O(n log n)'],
    explanation: 'Binary search halves the remaining interval each step, taking at most log₂(n) steps.',
  },
  {
    prompt: 'Which data structure follows Last-In, First-Out (LIFO) order?',
    correct: 'Stack',
    distractors: ['Queue', 'Hash Table', 'Linked List'],
    explanation: 'Items pushed onto the top of a Stack are popped off first (LIFO).',
  },
  {
    prompt: 'In relational SQL databases, which key uniquely identifies every row in a table?',
    correct: 'PRIMARY KEY',
    distractors: ['FOREIGN KEY', 'INDEX BY', 'ORDER BY'],
    explanation: 'A PRIMARY KEY enforces uniqueness and non-null values across all rows.',
  },
  {
    prompt: 'In Boolean logic, what is the output of (1 AND 0) OR (NOT 0)?',
    correct: '1',
    distractors: ['0', 'Undefined', '-1'],
    explanation: '(1 AND 0) = 0, (NOT 0) = 1, and 0 OR 1 = 1.',
  },
  {
    prompt: 'Which logic gate outputs 1 ONLY when both inputs are different (one 1 and one 0)?',
    correct: 'XOR gate',
    distractors: ['AND gate', 'OR gate', 'NOR gate'],
    explanation: 'Exclusive-OR (XOR) returns true strictly when its two inputs differ.',
  },
  {
    prompt: 'Which protocol secures HTTP web traffic with end-to-end encryption?',
    correct: 'HTTPS (TLS)',
    distractors: ['FTP', 'SMTP', 'Telnet'],
    explanation: 'HTTPS wraps HTTP over Transport Layer Security (TLS) for encrypted communication.',
  },
];

function generateStudentIct(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level * 5 + randInt(rng, 0, 3)) % 4;

  if (variant === 0) {
    const val = randInt(rng, 10, 63 + Math.min(60, Math.floor(level / 12)));
    const bin = val.toString(2);
    const { options, correctIndex } = buildOptions(
      String(val),
      [String(val + 1), String(val - 1), String(val + 4), String(Math.max(2, val - 2))],
      rng,
    );
    return {
      id: slotId,
      subject: 'ICT & Programming',
      prompt: `Convert the binary number ${bin}₂ to decimal (base 10):`,
      options,
      correctIndex,
      explanation: `Evaluating the binary place values of ${bin}₂ gives ${val}.`,
    };
  }

  if (variant === 1) {
    const dec = randInt(rng, 18, 250);
    const hex = dec.toString(16).toUpperCase();
    const alt1 = (dec + 1).toString(16).toUpperCase();
    const alt2 = Math.max(10, dec - 2).toString(16).toUpperCase();
    const alt3 = (dec + 16).toString(16).toUpperCase();
    const { options, correctIndex } = buildOptions(hex, [alt1, alt2, alt3], rng);
    return {
      id: slotId,
      subject: 'ICT & Programming',
      prompt: `What is the hexadecimal (base 16) representation of decimal ${dec}?`,
      options,
      correctIndex,
      explanation: `${dec} ÷ 16 gives remainder digits forming ${hex}₁₆.`,
    };
  }

  if (variant === 2) {
    const start = randInt(rng, 1, 5);
    const stop = start + randInt(rng, 3, 8);
    const count = stop - start;
    const { options, correctIndex } = buildOptions(
      String(count),
      [String(count + 1), String(Math.max(1, count - 1)), String(stop), String(start + stop)],
      rng,
    );
    return {
      id: slotId,
      subject: 'ICT & Programming',
      prompt: `In Python, what value does len(range(${start}, ${stop})) return?`,
      options,
      correctIndex,
      explanation: `range(${start}, ${stop}) generates integers from ${start} to ${stop - 1}, so length is ${count}.`,
    };
  }

  const item = STUDENT_ICT_CONCEPTS[(level - 1) % STUDENT_ICT_CONCEPTS.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: 'ICT & Programming',
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation,
  };
}

const STUDENT_ENGLISH_BANK: readonly ConceptEntry[] = [
  {
    prompt: 'Select the sentence with correct parallel structure:',
    correct: 'She enjoys reading essays, solving equations, and tutoring peers.',
    distractors: [
      'She enjoys reading essays, to solve equations, and tutoring peers.',
      'She enjoys to read essays, solving equations, and tutor peers.',
      'She enjoys reading essays, solved equations, and to tutor peers.',
    ],
    explanation: 'Parallel items in a list must share the same grammatical form (all gerunds).',
  },
  {
    prompt: 'Choose the closest synonym for "mitigate" in academic writing:',
    correct: 'Alleviate',
    distractors: ['Aggravate', 'Fabricate', 'Negate'],
    explanation: '"Mitigate" means to lessen severity or impact, matching "alleviate".',
  },
  {
    prompt: 'Which sentence uses the semicolon accurately?',
    correct: 'The lab test succeeded; however, further trials are planned.',
    distractors: [
      'Because the lab test succeeded; further trials are planned.',
      'The lab test succeeded; and further trials are planned.',
      'The lab test; however succeeded on Monday.',
    ],
    explanation: 'A semicolon links two independent clauses joined by a conjunctive adverb like "however".',
  },
  {
    prompt: 'Choose the best word: "Her _____ explanation cleared up every doubt in seconds."',
    correct: 'Lucid',
    distractors: ['Ambiguous', 'Cryptic', 'Verbose'],
    explanation: '"Lucid" means crystal clear and easy to follow.',
  },
  {
    prompt: 'Complete the third conditional: "If he _____ earlier, he would have joined the seminar."',
    correct: 'had arrived',
    distractors: ['arrived', 'would arrive', 'has arrived'],
    explanation: 'Unreal past conditionals use "If + past perfect (had arrived), ... would have + past participle".',
  },
  {
    prompt: 'Choose the correct subject-verb agreement:',
    correct: 'Neither the coach nor the players were late for practice.',
    distractors: [
      'Neither the coach nor the players was late for practice.',
      'Each of the Physics notebooks have been graded.',
      'The committee of senior judges agree with none of it.',
    ],
    explanation: 'With "neither ... nor", the verb agrees with the closer noun ("players" → "were").',
  },
  {
    prompt: 'Select the antonym of "ephemeral":',
    correct: 'Enduring',
    distractors: ['Fleeting', 'Brief', 'Fragile'],
    explanation: '"Ephemeral" means short-lived; its opposite is "enduring" or permanent.',
  },
];

function generateStudentEnglish(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const item = STUDENT_ENGLISH_BANK[(level - 1) % STUDENT_ENGLISH_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: 'Academic English',
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation,
  };
}

function generateStudentAnalytical(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level + randInt(rng, 0, 2)) % 3;

  if (variant === 0) {
    const start = randInt(rng, 2, 7);
    const mult = randInt(rng, 2, 3);
    const add = randInt(rng, 1, 5);
    const s1 = start;
    const s2 = s1 * mult + add;
    const s3 = s2 * mult + add;
    const s4 = s3 * mult + add;
    const { options, correctIndex } = buildOptions(
      String(s4),
      [String(s4 + add), String(s4 - 2), String(s3 * mult), String(s4 + mult)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Analytical Reasoning',
      prompt: `Find the next number in the sequence: ${s1}, ${s2}, ${s3}, ___`,
      options,
      correctIndex,
      explanation: `Each term is (previous × ${mult}) + ${add}: ${s3} × ${mult} + ${add} = ${s4}.`,
    };
  }

  if (variant === 1) {
    const speed = randInt(rng, 4, 12) * 5; // km/h
    const hours = randInt(rng, 2, 5);
    const dist = speed * hours;
    const { options, correctIndex } = buildOptions(
      `${dist} km`,
      [`${speed + hours} km`, `${dist + speed} km`, `${Math.max(10, dist - 20)} km`, `${speed * 2} km`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Analytical Reasoning',
      prompt: `A train travels steadily at ${speed} km/h for ${hours} hours. What distance does it cover?`,
      options,
      correctIndex,
      explanation: `Distance = Speed × Time = ${speed} × ${hours} = ${dist} km.`,
    };
  }

  const fact: ConceptEntry = {
    prompt: 'What is the logical negation of "All students completed the assignment"?',
    correct: 'At least one student did not complete the assignment.',
    distractors: [
      'No student completed the assignment.',
      'All students failed the assignment.',
      'Most students completed the assignment.',
    ],
    explanation: 'Negating a universal claim ("All P") requires only one counterexample ("At least one is not P").',
  };
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: 'Analytical Reasoning',
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation,
  };
}

// ============================================================================
// TUTOR TRACK QUESTION GENERATORS (Pedagogy + Higher-Order Academic Mastery)
// ============================================================================

const TUTOR_PEDAGOGY_BANK: readonly ConceptEntry[] = [
  {
    prompt: "In Vygotsky's framework, what defines a student's Zone of Proximal Development (ZPD)?",
    correct: 'Tasks a learner can master with guided scaffolding but not yet alone',
    distractors: [
      'Topics already mastered independently without feedback',
      'Memorizing formulas before conceptual intuition',
      'Material far beyond prerequisite skills even with hints',
    ],
    explanation:
      'Effective tutoring targets the ZPD — challenging enough to stretch reasoning, supported by targeted scaffolding.',
  },
  {
    prompt: 'Which study method yields the highest long-term exam retention according to cognitive research?',
    correct: 'Spaced active retrieval practice mixed with interleaved problems',
    distractors: [
      'Passive massed re-reading of highlighted notes before exams',
      'Copying worked solutions verbatim multiple times',
      'Blocking 50 identical problems before reviewing concepts',
    ],
    explanation:
      'Spacing + retrieval practice + interleaving strengthens neural recall pathways far more than passive re-reading.',
  },
  {
    prompt: 'A student consistently writes (a + b)² = a² + b². What is the strongest diagnostic tutoring response?',
    correct: 'Ask them to plug in a = 2, b = 3 to discover the missing 2ab term themselves',
    distractors: [
      'Give 20 repetitive drills without discussing why it failed',
      'Tell them to memorize the formula faster next time',
      'Move directly to multivariable calculus',
    ],
    explanation:
      'Counterexample testing helps learners confront and permanently correct structural algebraic misconceptions.',
  },
  {
    prompt: 'Which action exemplifies Formative Assessment during a live 1-on-1 tuition session?',
    correct: 'Pausing mid-lesson for a quick 2-minute check question to adapt pacing',
    distractors: [
      'Waiting until the final monthly exam to identify weak chapters',
      'Assigning grades without written diagnostic feedback',
      'Lecturing uninterrupted for 90 minutes to finish the chapter',
    ],
    explanation:
      'Formative checks provide real-time evidence so a tutor can recalibrate explanations before gaps compound.',
  },
  {
    prompt: 'On Bloom’s Revised Taxonomy, asking a student to "design an experiment testing Ohm’s Law" targets:',
    correct: 'Creating (highest-order cognitive skill)',
    distractors: [
      'Remembering (basic recall)',
      'Understanding (paraphrasing only)',
      'Recognizing definitions',
    ],
    explanation:
      'Designing original investigations or solutions sits at the top synthesis/Creating tier of Bloom’s Taxonomy.',
  },
  {
    prompt: 'When managing a mixed-ability tuition batch of 8 students, how should a tutor differentiate?',
    correct: 'Use tiered problem sets (core → stretch) while keeping one shared conceptual anchor',
    distractors: [
      'Teach exclusively at the pace of the fastest student',
      'Skip foundational explanations for everyone',
      'Avoid giving feedback to weaker students publicly or privately',
    ],
    explanation:
      'Tiered tasks preserve whole-group cohesion while keeping both struggling and advanced learners appropriately stretched.',
  },
  {
    prompt: 'In Socratic tutoring, why does a mentor respond to a student’s guess with a probing follow-up question?',
    correct: 'To help the learner trace their own reasoning and uncover hidden assumptions',
    distractors: [
      'To delay giving the syllabus schedule',
      'To conceal whether the answer was right or wrong indefinitely',
      'To replace worked examples completely',
    ],
    explanation:
      'Socratic questioning builds metacognition so students learn how to self-verify during real exams.',
  },
  {
    prompt: 'Which rubric design practice makes CQ (written exam) grading clearest for students?',
    correct: 'Breaking marks into explicit criteria: setup/formula, algebraic step, and unit accuracy',
    distractors: [
      'Assigning a single holistic letter grade with no step breakdown',
      'Deducting random points for handwriting style',
      'Only grading the final numerical line',
    ],
    explanation:
      'Analytic criterion rubrics teach students exactly how partial credit works in board and admission exams.',
  },
  {
    prompt: 'What is "scaffolding fade" in long-term academic mentorship?',
    correct: 'Gradually removing hints and templates as the student gains independent fluency',
    distractors: [
      'Adding extra formula sheets before every mock test',
      'Solving the first half of every exam question for the student permanently',
      'Canceling weekly practice reviews once scores rise once',
    ],
    explanation:
      'Scaffolds are temporary supports meant to be faded out so learners perform independently under exam pressure.',
  },
  {
    prompt: 'A high-performing student freezes under timed mock tests despite strong homework scores. What should the tutor introduce?',
    correct: 'Short timed micro-sprints (e.g., 10-minute checkpoints) with calm triage strategies',
    distractors: [
      'Eliminate all time limits until exam week',
      'Increase daily homework volume without practicing pacing',
      'Tell them never to skip any hard question first',
    ],
    explanation:
      'Low-stakes timed micro-sprints desensitize test anxiety and train smart question-triage habits.',
  },
];

function generateTutorPedagogy(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const item = TUTOR_PEDAGOGY_BANK[(level - 1) % TUTOR_PEDAGOGY_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: 'Pedagogy & Mentorship',
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation,
  };
}

function generateTutorAdvancedMath(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level * 5 + randInt(rng, 0, 5)) % 6;

  if (variant === 0) {
    // Definite integral ∫_0^b (3k x^2 + 2c x) dx = k b^3 + c b^2
    const k = randInt(rng, 1, 4);
    const c = randInt(rng, 1, 5);
    const b = randInt(rng, 2, 4);
    const ans = k * Math.pow(b, 3) + c * Math.pow(b, 2);
    const { options, correctIndex } = buildOptions(
      String(ans),
      [String(ans + b), String(3 * k * b * b + 2 * c * b), String(Math.max(4, ans - c * b)), String(ans * 2)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Advanced Calculus & Algebra',
      prompt: `Evaluate the definite integral: ∫₀^${b} (${3 * k}x² + ${2 * c}x) dx`,
      options,
      correctIndex,
      explanation: `Antiderivative is ${k}x³ + ${c}x². Evaluating from 0 to ${b} gives ${k}(${b}³) + ${c}(${b}²) = ${ans}.`,
    };
  }

  if (variant === 1) {
    // 2x2 Matrix determinant
    const a = randInt(rng, 3, 9);
    const b = randInt(rng, 2, 7);
    const c = randInt(rng, 1, 5);
    const d = randInt(rng, 3, 9);
    const det = a * d - b * c;
    const { options, correctIndex } = buildOptions(
      String(det),
      [String(a * d + b * c), String(det + b), String(det - c), String(a * b - c * d)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Linear Algebra',
      prompt: `Compute the determinant of the 2×2 matrix [[${a}, ${b}], [${c}, ${d}]].`,
      options,
      correctIndex,
      explanation: `det(A) = (${a} × ${d}) − (${b} × ${c}) = ${a * d} − ${b * c} = ${det}.`,
    };
  }

  if (variant === 2) {
    // Optimization / critical point of f(x) = -a x^2 + b x + c
    const a = randInt(rng, 1, 4);
    const xMax = randInt(rng, 2, 7);
    const b = 2 * a * xMax;
    const c = randInt(rng, 3, 15);
    const maxVal = -a * xMax * xMax + b * xMax + c;
    const { options, correctIndex } = buildOptions(
      String(maxVal),
      [String(xMax), String(maxVal + a), String(c), String(maxVal - xMax)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Advanced Calculus & Algebra',
      prompt: `Find the global maximum value of the quadratic function f(x) = −${a}x² + ${b}x + ${c}.`,
      options,
      correctIndex,
      explanation: `f'(x) = −${2 * a}x + ${b} = 0 gives x = ${xMax}. Substituting yields f(${xMax}) = ${maxVal}.`,
    };
  }

  if (variant === 3) {
    // Infinite geometric series S = a / (1 - r) with r = 1/k
    const k = pick(rng, [2, 3, 4] as const);
    const a = randInt(rng, 2, 6) * (k - 1);
    const sum = (a * k) / (k - 1);
    const { options, correctIndex } = buildOptions(
      String(sum),
      [String(a * k), String(sum + a), String(Math.max(2, sum - k)), String(a + k)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Infinite Series & Olympiad Math',
      prompt: `Compute the sum to infinity of the geometric series with first term a = ${a} and common ratio r = 1/${k}.`,
      options,
      correctIndex,
      explanation: `S∞ = a / (1 − 1/${k}) = ${a} × ${k} / ${k - 1} = ${sum}.`,
    };
  }

  if (variant === 4) {
    // Modular arithmetic: find remainder of base^exp mod p
    const base = randInt(rng, 2, 6);
    const exp = randInt(rng, 5, 8);
    const mod = pick(rng, [7, 11, 13] as const);
    let rem = 1;
    for (let i = 0; i < exp; i += 1) {
      rem = (rem * base) % mod;
    }
    const { options, correctIndex } = buildOptions(
      String(rem),
      [String((rem + 1) % mod), String((rem + 2) % mod), String((rem + 3) % mod), String(mod - 1)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Number Theory',
      prompt: `Using modular arithmetic, find ${base}^${exp} mod ${mod}.`,
      options,
      correctIndex,
      explanation: `Repeated squaring modulo ${mod} reduces ${base}^${exp} to remainder ${rem}.`,
    };
  }

  // Orthogonal vectors dot product
  const v1 = randInt(rng, 2, 6);
  const v2 = randInt(rng, 3, 8);
  const w1 = randInt(rng, 2, 5);
  const k = -(v1 * w1) / v2;
  // Make clean integer by picking w1 = v2
  const cleanW1 = v2;
  const cleanAns = -v1;
  const { options, correctIndex } = buildOptions(
    String(cleanAns),
    [String(v1), String(cleanW1), String(cleanAns - 2), String(0)],
    rng,
  );
  void k;
  void w1;
  return {
    id: slotId,
    subject: 'Vector Geometry',
    prompt: `For what value of λ are vectors u = (${v1}, ${v2}) and v = (${cleanW1}, λ) orthogonal?`,
    options,
    correctIndex,
    explanation: `Orthogonal vectors satisfy u · v = 0 → ${v1}(${cleanW1}) + ${v2}λ = 0 → λ = ${cleanAns}.`,
  };
}

function generateTutorAdvancedPhysics(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level * 3 + randInt(rng, 0, 4)) % 5;

  if (variant === 0) {
    // Parallel resistors R1 and R2
    const pairs: Array<[number, number, number]> = [
      [6, 3, 2],
      [12, 4, 3],
      [10, 10, 5],
      [12, 6, 4],
      [15, 10, 6],
      [20, 5, 4],
    ];
    const [r1, r2, req] = pairs[(level + randInt(rng, 0, pairs.length - 1)) % pairs.length];
    const { options, correctIndex } = buildOptions(
      `${req} Ω`,
      [`${r1 + r2} Ω`, `${Math.round((r1 + r2) / 2)} Ω`, `${req + 2} Ω`, `${r1} Ω`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Electromagnetism & Circuits',
      prompt: `Two resistors of ${r1} Ω and ${r2} Ω are connected in parallel. What is their equivalent resistance?`,
      options,
      correctIndex,
      explanation: `1/Req = 1/${r1} + 1/${r2} → Req = (${r1}×${r2})/(${r1}+${r2}) = ${req} Ω.`,
    };
  }

  if (variant === 1) {
    // Capacitor energy U = 0.5 * C * V^2 (microfarads & volts -> mJ or uJ)
    const c = randInt(rng, 2, 8) * 2; // uF
    const v = randInt(rng, 5, 12); // V
    const energy = 0.5 * c * v * v; // uJ
    const { options, correctIndex } = buildOptions(
      `${energy} µJ`,
      [`${c * v} µJ`, `${c * v * v} µJ`, `${energy + c} µJ`, `${Math.round(energy / 2)} µJ`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Electromagnetism & Circuits',
      prompt: `A ${c} µF capacitor is charged to ${v} V. How much electrostatic energy is stored in it?`,
      options,
      correctIndex,
      explanation: `U = ½CV² = 0.5 × ${c} µF × (${v} V)² = ${energy} µJ.`,
    };
  }

  if (variant === 2) {
    // Projectile time of flight T = 2 * vy / g (take g = 10 m/s^2)
    const vy = randInt(rng, 2, 7) * 5;
    const tFlight = (2 * vy) / 10;
    const { options, correctIndex } = buildOptions(
      `${tFlight} s`,
      [`${vy / 10} s`, `${tFlight + 2} s`, `${tFlight * 2} s`, `${Math.max(1, tFlight - 1)} s`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Classical Mechanics',
      prompt: `A projectile is launched over flat ground with initial vertical velocity component v_y = ${vy} m/s (take g = 10 m/s²). Find the total time of flight.`,
      options,
      correctIndex,
      explanation: `Time of flight T = 2v_y / g = (2 × ${vy}) / 10 = ${tFlight} s.`,
    };
  }

  if (variant === 3) {
    // Torque τ = r * F * sin(90)
    const r = randInt(rng, 2, 6);
    const f = randInt(rng, 10, 35);
    const torque = r * f;
    const { options, correctIndex } = buildOptions(
      `${torque} N·m`,
      [`${f / r} N·m`, `${torque + f} N·m`, `${f + r} N·m`, `${torque * 2} N·m`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Rotational Mechanics',
      prompt: `A force of ${f} N is applied perpendicularly at a lever arm of ${r} m from the pivot. What is the torque magnitude?`,
      options,
      correctIndex,
      explanation: `τ = rF sin(90°) = ${r} × ${f} = ${torque} N·m.`,
    };
  }

  const fact: ConceptEntry = {
    prompt: 'In the photoelectric effect, increasing the incident light frequency (above threshold) directly increases:',
    correct: 'The maximum kinetic energy of emitted photoelectrons',
    distractors: [
      'The work function of the metal surface',
      'The Planck constant',
      'Only the number of emitted electrons per second at fixed intensity',
    ],
    explanation: 'By Einstein’s equation K_max = hf − Φ, higher frequency f raises K_max linearly.',
  };
  const { options, correctIndex } = buildOptions(fact.correct, fact.distractors, rng);
  return {
    id: slotId,
    subject: 'Modern Physics',
    prompt: fact.prompt,
    options,
    correctIndex,
    explanation: fact.explanation,
  };
}

const TUTOR_CHEM_BANK: readonly ConceptEntry[] = [
  {
    prompt: 'When ΔH < 0 and ΔS > 0 for a chemical process, Gibbs free energy ΔG = ΔH − TΔS indicates the reaction is:',
    correct: 'Spontaneous at all temperatures',
    distractors: [
      'Non-spontaneous at all temperatures',
      'Spontaneous only at low temperatures',
      'Always at chemical equilibrium',
    ],
    explanation: 'With ΔH negative and −TΔS negative (since ΔS > 0, T > 0), ΔG < 0 at every temperature.',
  },
  {
    prompt: 'In a buffer where weak acid concentration equals its conjugate base ([HA] = [A⁻]), the pH equals:',
    correct: 'pKₐ',
    distractors: ['14 − pKₐ', '7.00 always', '2 × pKₐ'],
    explanation: 'Henderson–Hasselbalch: pH = pKₐ + log₁₀([A⁻]/[HA]) = pKₐ + log₁₀(1) = pKₐ.',
  },
  {
    prompt: 'For the gas-phase equilibrium N₂(g) + 3H₂(g) ⇌ 2NH₃(g), increasing pressure at constant T shifts equilibrium:',
    correct: 'Toward NH₃ (side with fewer gas moles)',
    distractors: [
      'Toward N₂ and H₂ (more gas moles)',
      'Nowhere, because Kp never responds to volume',
      'To halt the forward rate',
    ],
    explanation: 'By Le Chatelier’s Principle, higher pressure favors 2 moles of NH₃ over 4 moles of reactants.',
  },
  {
    prompt: 'Which thermodynamic function determines the equilibrium constant K via ΔG° = −RT ln K?',
    correct: 'Standard Gibbs free energy change (ΔG°)',
    distractors: ['Activation energy (Eₐ)', 'Bond order', 'Molar conductivity'],
    explanation: 'ΔG° governs thermodynamic favorability and K; Eₐ governs reaction rate.',
  },
];

function generateTutorChemistry(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const variant = (level * 7 + randInt(rng, 0, 2)) % 3;

  if (variant === 0) {
    // Half-life decay
    const halfLife = randInt(rng, 2, 6);
    const periods = randInt(rng, 2, 4);
    const totalTime = halfLife * periods;
    const startMass = Math.pow(2, periods) * randInt(rng, 3, 7);
    const remaining = startMass / Math.pow(2, periods);
    const { options, correctIndex } = buildOptions(
      `${remaining} g`,
      [`${startMass / 2} g`, `${remaining * 2} g`, `${Math.max(1, remaining - 2)} g`, `${startMass / periods} g`],
      rng,
    );
    return {
      id: slotId,
      subject: 'Physical Chemistry',
      prompt: `A first-order sample of ${startMass} g has a half-life of ${halfLife} hours. How much remains after ${totalTime} hours?`,
      options,
      correctIndex,
      explanation: `${totalTime} / ${halfLife} = ${periods} half-lives. Remaining mass = ${startMass} / 2^${periods} = ${remaining} g.`,
    };
  }

  if (variant === 1) {
    // Galvanic cell E°cell = E°cathode - E°anode
    const eCathode = pick(rng, [0.34, 0.80, 1.36] as const);
    const eAnode = pick(rng, [-0.76, -0.44, -0.25] as const);
    const eCell = Number((eCathode - eAnode).toFixed(2));
    const { options, correctIndex } = buildOptions(
      `${eCell.toFixed(2)} V`,
      [
        `${(eCathode + eAnode).toFixed(2)} V`,
        `${(eCell + 0.5).toFixed(2)} V`,
        `${(eAnode - eCathode).toFixed(2)} V`,
      ],
      rng,
    );
    return {
      id: slotId,
      subject: 'Electrochemistry',
      prompt: `A galvanic cell pairs a cathode reduction potential of +${eCathode.toFixed(2)} V with an anode reduction potential of ${eAnode.toFixed(2)} V. Compute E°_cell.`,
      options,
      correctIndex,
      explanation: `E°_cell = E°_cathode − E°_anode = ${eCathode.toFixed(2)} − (${eAnode.toFixed(2)}) = ${eCell.toFixed(2)} V.`,
    };
  }

  const item = TUTOR_CHEM_BANK[(level - 1) % TUTOR_CHEM_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: 'Physical & Organic Chemistry',
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation,
  };
}

const TUTOR_CS_BANK: readonly ConceptEntry[] = [
  {
    prompt: 'What is the time complexity of Merge Sort on an array of n elements in the worst case?',
    correct: 'O(n log n)',
    distractors: ['O(n²)', 'O(n)', 'O(log n)'],
    explanation: 'Merge Sort splits recursively to depth log₂ n and merges linearly at every level, guaranteeing O(n log n).',
  },
  {
    prompt: 'In database transactions, which ACID property guarantees partial failures roll back completely?',
    correct: 'Atomicity',
    distractors: ['Isolation', 'Durability', 'Sharding'],
    explanation: 'Atomicity enforces all-or-nothing execution for multi-step database transactions.',
  },
  {
    prompt: 'Which graph algorithm finds single-source shortest paths with non-negative edge weights using a min-heap?',
    correct: "Dijkstra's Algorithm",
    distractors: ["Kruskal's MST", 'Topological Sort', 'Floyd-Warshall only'],
    explanation: "Dijkstra's greedy priority-queue expansion guarantees optimal shortest paths when edge weights are ≥ 0.",
  },
  {
    prompt: 'Which HTTP method is defined as both safe and idempotent in REST architecture?',
    correct: 'GET',
    distractors: ['POST', 'PATCH', 'CONNECT'],
    explanation: 'GET retrieves representations without mutating server state (safe) and produces identical results when repeated.',
  },
  {
    prompt: 'By the Master Theorem, the recurrence T(n) = 2T(n/2) + Θ(n) solves to:',
    correct: 'Θ(n log n)',
    distractors: ['Θ(n)', 'Θ(n²)', 'Θ(log² n)'],
    explanation: 'Case 2 of the Master Theorem applies since f(n) = Θ(n^(log_2 2)), giving Θ(n log n).',
  },
  {
    prompt: 'Why is Dynamic Programming effective for overlapping subproblems with optimal substructure?',
    correct: 'Memoizing/tabulating subproblem answers avoids exponential redundant recomputation',
    distractors: [
      'It converts every NP-hard graph into O(1) lookup',
      'It eliminates base cases in recursion',
      'It sorts inputs before branching',
    ],
    explanation: 'Storing solved subproblems reduces exponential recursion trees into polynomial time.',
  },
];

function generateTutorCs(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  if (level % 3 === 0) {
    // Recurrence / tree height or DP step calculation
    const depth = randInt(rng, 4, 8);
    const maxNodes = Math.pow(2, depth) - 1;
    const { options, correctIndex } = buildOptions(
      String(maxNodes),
      [String(Math.pow(2, depth)), String(Math.pow(2, depth - 1)), String(depth * 2), String(maxNodes - 2)],
      rng,
    );
    return {
      id: slotId,
      subject: 'Algorithms & Systems',
      prompt: `What is the maximum total number of nodes in a full binary tree of height/levels ${depth} (root at level 1)?`,
      options,
      correctIndex,
      explanation: `A full binary tree of ${depth} levels holds 2^${depth} − 1 = ${maxNodes} nodes.`,
    };
  }

  const item = TUTOR_CS_BANK[(level - 1) % TUTOR_CS_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: 'Algorithms & Systems',
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation,
  };
}

const TUTOR_CRITICAL_LOGIC_BANK: readonly ConceptEntry[] = [
  {
    prompt: 'What is the logical contrapositive of "If a student practices daily, then their confidence grows"?',
    correct: 'If confidence does not grow, then the student does not practice daily.',
    distractors: [
      'If confidence grows, then the student practices daily.',
      'If a student does not practice daily, then confidence does not grow.',
      'Confidence grows only when homework is skipped.',
    ],
    explanation: 'The contrapositive of P → Q is ¬Q → ¬P, which is always logically equivalent to P → Q.',
  },
  {
    prompt: 'Arguing "Because mock scores rose right after changing notebooks, the notebook color caused higher scores" commits:',
    correct: 'Post hoc ergo propter hoc fallacy',
    distractors: ['Straw man fallacy', 'Ad hominem fallacy', 'Circular definition'],
    explanation: 'Assuming temporal sequence alone proves causation is the classic post hoc fallacy.',
  },
  {
    prompt: 'In academic writing, which transition introduces a genuine logical concession before a counter-claim?',
    correct: 'Admittedly, ...; nevertheless, ...',
    distractors: ['Consequently, ...; therefore, ...', 'Identically, ...; thus, ...', 'Whereas, ...; hence, ...'],
    explanation: '"Admittedly ...; nevertheless ..." acknowledges an opposing point before pivoting cleanly.',
  },
  {
    prompt: 'Which research design best isolates cause and effect when evaluating a new teaching intervention?',
    correct: 'Randomized controlled comparison with pre/post diagnostic baselines',
    distractors: [
      'Collecting voluntary testimonials without baseline scores',
      'Measuring only the top 10% of volunteers post-course',
      'Changing three unrelated grading scales mid-term',
    ],
    explanation: 'Random assignment + baseline controls eliminate selection bias and confounding factors.',
  },
];

function generateTutorCriticalReasoning(level: number, slotId: string, rng: () => number): DailyQuestionDef {
  const item = TUTOR_CRITICAL_LOGIC_BANK[(level - 1) % TUTOR_CRITICAL_LOGIC_BANK.length];
  const { options, correctIndex } = buildOptions(item.correct, item.distractors, rng);
  return {
    id: slotId,
    subject: 'Critical Reasoning & Logic',
    prompt: item.prompt,
    options,
    correctIndex,
    explanation: item.explanation,
  };
}

export function generateDailyLevelQuiz(
  level: number,
  track: DailyTrack = 'student',
): DailyLevelQuizDef {
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_DAILY_LEVELS) {
    throw new Error(`Daily level must be an integer between 1 and ${TOTAL_DAILY_LEVELS}.`);
  }

  const normalizedTrack = resolveDailyTrack(track);
  const seed = normalizedTrack === 'tutor' ? level * 7919 + 104729 : level * 6271 + 31;
  const rng = createRng(seed);
  const badge = getBadgeForLevel(level, normalizedTrack);
  const tierName = getTierName(level, normalizedTrack);
  const xpReward =
    (normalizedTrack === 'tutor' ? 35 : 25) + Math.floor(level / 25) * 5 + (badge ? 40 : 0);

  let questions: DailyQuestionDef[];
  let subjectMix: string;

  if (normalizedTrack === 'tutor') {
    const tutorPool = [
      (slotId: string) => generateTutorAdvancedMath(level, slotId, rng),
      (slotId: string) => generateTutorAdvancedPhysics(level, slotId, rng),
      (slotId: string) => generateTutorChemistry(level, slotId, rng),
      (slotId: string) => generateTutorCs(level, slotId, rng),
      (slotId: string) => generateTutorCriticalReasoning(level, slotId, rng),
    ];
    // Rotate secondary academic modules each level while always keeping Pedagogy & Mentorship in slot 1
    const offset = level % tutorPool.length;
    const rotated = [...tutorPool.slice(offset), ...tutorPool.slice(0, offset)].slice(0, 4);
    questions = [
      generateTutorPedagogy(level, `d_tutor_${level}_q1`, rng),
      ...rotated.map((gen, idx) => gen(`d_tutor_${level}_q${idx + 2}`)),
    ];
    subjectMix = Array.from(new Set(questions.map((q) => q.subject))).join(' · ');

    return {
      level,
      track: 'tutor',
      trackLabel: 'Tutor Mastery Track',
      tierName,
      title: badge ? `Tutor Level ${level} · ${badge.name}` : `Tutor Daily Challenge — Level ${level}`,
      subjectMix,
      passingScore: DAILY_PASSING_SCORE,
      xpReward,
      badge,
      questions,
    };
  }

  const studentPool = [
    (slotId: string) => generateStudentMath(level, slotId, rng),
    (slotId: string) => generateStudentPhysics(level, slotId, rng),
    (slotId: string) => generateStudentChemistry(level, slotId, rng),
    (slotId: string) => generateStudentBiology(level, slotId, rng),
    (slotId: string) => generateStudentIct(level, slotId, rng),
    (slotId: string) => generateStudentEnglish(level, slotId, rng),
    (slotId: string) => generateStudentAnalytical(level, slotId, rng),
  ];
  const offset = level % studentPool.length;
  const pickedGenerators = [
    studentPool[offset],
    studentPool[(offset + 1) % studentPool.length],
    studentPool[(offset + 2) % studentPool.length],
    studentPool[(offset + 4) % studentPool.length],
    studentPool[(offset + 5) % studentPool.length],
  ];
  questions = pickedGenerators.map((gen, idx) => gen(`d_student_${level}_q${idx + 1}`));
  subjectMix = Array.from(new Set(questions.map((q) => q.subject))).join(' · ');

  return {
    level,
    track: 'student',
    trackLabel: 'Student Academic Track',
    tierName,
    title: badge ? `Student Level ${level} · ${badge.name}` : `Student Daily Challenge — Level ${level}`,
    subjectMix,
    passingScore: DAILY_PASSING_SCORE,
    xpReward,
    badge,
    questions,
  };
}
