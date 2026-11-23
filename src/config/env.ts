const PLACEHOLDER_TOKENS = [
  'replace-with',
  'change-me',
  'changeme',
  'placeholder',
  'your_',
  'example_secret',
];

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isPlaceholderValue(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return PLACEHOLDER_TOKENS.some((token) => lower.includes(token));
}

export function isStrongSecret(value: string | undefined, minLength = 32): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  return !isPlaceholderValue(trimmed);
}

function normalizeOrigin(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function getAllowedOrigins(): string[] {
  const candidates: string[] = [];
  for (const key of ['CLIENT_URL', 'APP_URL', 'BETTER_AUTH_URL']) {
    const val = process.env[key]?.trim();
    if (val) candidates.push(val);
  }
  const extra = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (extra) {
    for (const part of extra.split(',')) {
      if (part.trim()) candidates.push(part.trim());
    }
  }
  if (!isProduction()) {
    candidates.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    );
  }

  const normalized = new Set<string>();
  for (const item of candidates) {
    const norm = normalizeOrigin(item);
    if (norm) normalized.add(norm);
  }
  return Array.from(normalized);
}

export function isOriginAllowed(origin: string | undefined, requestHost?: string): boolean {
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

export function getPrimaryAppOrigin(requestOrigin?: string, requestHost?: string): string {
  if (requestOrigin && isOriginAllowed(requestOrigin, requestHost)) {
    const norm = normalizeOrigin(requestOrigin);
    if (norm) return norm;
  }
  const configured =
    normalizeOrigin(process.env.CLIENT_URL || '') ||
    normalizeOrigin(process.env.APP_URL || '') ||
    normalizeOrigin(process.env.BETTER_AUTH_URL || '');
  if (configured) return configured;

  if (requestHost) {
    const proto = isProduction() ? 'https' : 'http';
    return `${proto}://${requestHost}`;
  }
  return 'http://localhost:3000';
}

export function validateRuntimeEnvironment(): void {
  const prod = isProduction();
  const warnings: string[] = [];
  const errors: string[] = [];

  const jwtSecret = process.env.JWT_SECRET?.trim();
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET?.trim();
  const mongoUri = process.env.MONGODB_URI?.trim();

  if (prod) {
    if (!isStrongSecret(jwtSecret, 32)) {
      errors.push('JWT_SECRET must be at least 32 non-placeholder characters in production.');
    }
    if (betterAuthSecret && !isStrongSecret(betterAuthSecret, 32)) {
      errors.push('BETTER_AUTH_SECRET must be at least 32 non-placeholder characters when set.');
    }
    if (!mongoUri && process.env.ALLOW_LOCAL_DB_IN_PROD !== 'true') {
      errors.push('MONGODB_URI is required in production unless ALLOW_LOCAL_DB_IN_PROD=true.');
    }
  } else {
    if (!jwtSecret || isPlaceholderValue(jwtSecret)) {
      warnings.push('Using ephemeral development JWT secret fallback.');
    }
  }

  for (const urlVar of ['APP_URL', 'CLIENT_URL', 'BETTER_AUTH_URL']) {
    const val = process.env[urlVar]?.trim();
    if (val && !normalizeOrigin(val)) {
      errors.push(`${urlVar} must be a valid http:// or https:// URL.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }
  for (const w of warnings) {
    console.warn(`[Env] ${w}`);
  }
}
