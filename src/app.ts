import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { requestIdMiddleware } from './infrastructure/http/middleware/requestId';
import { setupHttpLogger } from './infrastructure/http/middleware/httpLogger';
import { authenticate, requirePermission } from './infrastructure/http/middleware/auth';
import { createHealthRouter } from './infrastructure/http/routers/health.router';
import { createStepsRouter } from './infrastructure/http/routers/steps.router';
import { createAdminRouter } from './infrastructure/http/routers/admin.router';
import {
  createGatewayRouter,
  type MetaWebhookConfig,
} from './infrastructure/http/routers/gateway.router';
import { createNodeEventsRouter } from './infrastructure/http/routers/nodeEvents.router';
import { createSwaggerRouter } from './infrastructure/http/swagger/swagger.router';
import { createJwtVerifierMiddleware } from './infrastructure/auth/JwtVerifierMiddleware';
import {
  applyRateLimits,
  applySecurityHeaders,
  loadSecurityConfig,
  type SecurityOverrides,
} from './infrastructure/http/security';
import { captureRawBody } from './infrastructure/meta/metaWebhookVerification';
import { MetaGraphClient } from './infrastructure/meta/MetaGraphClient';
import { createDedupeStore } from './infrastructure/meta/dedupeStore';
// ── Driven adapters ───────────────────────────────────────────────────────────
import { IntentsServiceClient } from './infrastructure/intents/IntentsServiceClient';
import { NodeRedClientAdapter } from './infrastructure/nodeRed/NodeRedClientAdapter';
// ── Ports ─────────────────────────────────────────────────────────────────────
import type { IIntentsServiceClient } from './application/ports/IIntentsServiceClient';
import type { INodeRedClient } from './application/ports/INodeRedClient';
import type { IGraphClient } from './application/ports/IGraphClient';
import type { IDedupeStore } from './application/ports/IDedupeStore';
// ── Application use cases ─────────────────────────────────────────────────────
import { ValidateNodeDeletionUseCase } from './application/intents/ValidateNodeDeletionUseCase';
import { RouteMessageUseCase } from './application/gateway/RouteMessageUseCase';
import { logError } from './shared/logger';

export interface AppConfig {
  jwtSecret: string;
  meta: MetaWebhookConfig;
}

/** Test seams: anything not provided is built from environment variables. */
export interface AppOverrides {
  config?: Partial<AppConfig>;
  intentsClient?: IIntentsServiceClient;
  nodeRedClient?: INodeRedClient;
  graphClient?: IGraphClient;
  dedupeStore?: IDedupeStore;
  security?: SecurityOverrides;
}

function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const jwtSecret = overrides.jwtSecret ?? process.env.AUTH_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('AUTH_JWT_SECRET is required');
  }

  return {
    jwtSecret,
    meta: overrides.meta ?? {
      appSecret: process.env.META_APP_SECRET ?? '',
      verifyToken: process.env.META_VERIFY_TOKEN ?? '',
      phoneNumberId: process.env.META_PHONE_NUMBER_ID || undefined,
    },
  };
}

function buildGraphClient(): IGraphClient {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('META_ACCESS_TOKEN is required');
  }
  return new MetaGraphClient({
    accessToken,
    apiVersion: process.env.META_API_VERSION || 'v21.0',
  });
}

export async function createApp(overrides: AppOverrides = {}): Promise<Express> {
  const app = express();
  const config = loadConfig(overrides.config);

  // ── Driven adapters (secondary ports) ────────────────────────────────────────
  const intentsClient = overrides.intentsClient ?? IntentsServiceClient.fromEnv();
  const nodeRedClient = overrides.nodeRedClient ?? new NodeRedClientAdapter();
  const graphClient = overrides.graphClient ?? buildGraphClient();
  const dedupeStore = overrides.dedupeStore ?? createDedupeStore(process.env.REDIS_URL);

  // ── Use cases (application layer, no infrastructure dependency) ──────────────
  const validateNodeDeletionUseCase = new ValidateNodeDeletionUseCase(intentsClient);
  const routeMessageUseCase = new RouteMessageUseCase(intentsClient, nodeRedClient);

  // ── Express middleware ────────────────────────────────────────────────────────
  const security = loadSecurityConfig(process.env, overrides.security);
  applySecurityHeaders(app, security);
  app.use(requestIdMiddleware);
  applyRateLimits(app, security);
  // Raw body ONLY for the Meta webhook (signature is computed over the exact bytes).
  // It must run before express.json(), which then skips the already-consumed stream.
  app.use('/webhooks/whatsapp', express.raw({ type: () => true, limit: '1mb' }), captureRawBody);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(createJwtVerifierMiddleware(config.jwtSecret));
  setupHttpLogger(app);

  // ── Route protection ──────────────────────────────────────────────────────────
  app.use('/api/admin', authenticate, requirePermission('WRITE', 'ADMIN'));
  app.use('/api/steps', authenticate);
  app.use('/api/node-events', authenticate, requirePermission('WRITE', 'ADMIN'));

  // ── Driving adapters (primary ports — HTTP routers) ───────────────────────────
  app.use(createHealthRouter());
  app.use(createSwaggerRouter());
  app.use(createStepsRouter());
  app.use(createNodeEventsRouter({ validateNodeDeletionUseCase }));
  app.use(createAdminRouter({ intentsClient }));
  app.use(
    createGatewayRouter({
      intentsCatalog: intentsClient,
      routeMessageUseCase,
      graphClient,
      dedupeStore,
      meta: config.meta,
    }),
  );

  // ── Error handler (malformed JSON, etc.) ──────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ ok: false, error: 'Invalid request' });
      return;
    }
    logError('http.unhandled_error', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  });

  return app;
}
