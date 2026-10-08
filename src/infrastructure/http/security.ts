import type { Express, RequestHandler } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

export type TrustProxySetting = boolean | number | string;

export interface RateLimitConfig {
  enabled: boolean;
  generalMax: number;
  generalWindowMs: number;
  webhookMax: number;
  webhookWindowMs: number;
}

export interface SecurityConfig {
  corsAllowedOrigins: string[];
  trustProxy: TrustProxySetting;
  rateLimit: RateLimitConfig;
}

export interface SecurityOverrides {
  corsAllowedOrigins?: string[];
  trustProxy?: TrustProxySetting;
  rateLimit?: Partial<RateLimitConfig>;
}

const WEBHOOK_PATH = '/webhooks/whatsapp';

export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** `TRUST_PROXY`: unset -> 1 hop (single load balancer); `false`; a hop count; or an Express subnet keyword. */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '') return 1;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Builds the security config from env. Rate limiting is off under NODE_ENV=test unless forced on. */
export function loadSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: SecurityOverrides = {},
): SecurityConfig {
  const enabledByDefault = env.NODE_ENV !== 'test';
  const enabledFromEnv =
    env.RATE_LIMIT_ENABLED === undefined || env.RATE_LIMIT_ENABLED === ''
      ? enabledByDefault
      : env.RATE_LIMIT_ENABLED !== 'false';
  return {
    corsAllowedOrigins: overrides.corsAllowedOrigins ?? parseOrigins(env.CORS_ALLOWED_ORIGINS),
    trustProxy: overrides.trustProxy ?? parseTrustProxy(env.TRUST_PROXY),
    rateLimit: {
      enabled: enabledFromEnv,
      generalMax: positiveInt(env.RATE_LIMIT_GENERAL_MAX, 300),
      generalWindowMs: positiveInt(env.RATE_LIMIT_GENERAL_WINDOW_MS, 60_000),
      webhookMax: positiveInt(env.RATE_LIMIT_WEBHOOK_MAX, 120),
      webhookWindowMs: positiveInt(env.RATE_LIMIT_WEBHOOK_WINDOW_MS, 60_000),
      ...overrides.rateLimit,
    },
  };
}

export function buildCorsOptions(allowedOrigins: string[]): CorsOptions {
  if (allowedOrigins.includes('*')) {
    // Wildcard is never combined with credentials.
    return { origin: '*', credentials: false };
  }
  return {
    credentials: true,
    origin: (origin, callback) => {
      // Non-browser clients (no Origin header) are not subject to CORS.
      callback(null, origin !== undefined && allowedOrigins.includes(origin));
    },
  };
}

function limiter(limit: number, windowMs: number, skip?: (path: string) => boolean): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skip ? (req) => skip(req.path) : undefined,
    handler: (_req, res) => {
      res.status(429).json({ ok: false, error: 'Too many requests' });
    },
  });
}

/** helmet + CORS + proxy trust. Must be mounted before any router. */
export function applySecurityHeaders(app: Express, config: SecurityConfig): void {
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors(buildCorsOptions(config.corsAllowedOrigins)));
}

/**
 * Rate limiters. The Meta webhook gets its own bucket (so Meta traffic neither
 * starves nor is starved by API clients); a 429 carries Retry-After and Meta retries later.
 */
export function applyRateLimits(app: Express, config: SecurityConfig): void {
  if (!config.rateLimit.enabled) return;
  const { generalMax, generalWindowMs, webhookMax, webhookWindowMs } = config.rateLimit;
  app.use(WEBHOOK_PATH, limiter(webhookMax, webhookWindowMs));
  app.use(
    limiter(
      generalMax,
      generalWindowMs,
      (path) => path === '/health' || path.startsWith(WEBHOOK_PATH),
    ),
  );
}
