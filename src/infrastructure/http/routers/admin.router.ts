import { Router, type Request, type Response } from 'express';
import type { IIntentsServiceClient, IntentsAdminResult } from '../../../application/ports/IIntentsServiceClient';
import { extractAccessToken } from '../../auth/JwtVerifierMiddleware';
import { requirePermission } from '../middleware/auth';
import { validateCreateIntentBody, validateUpdateIntentBody } from '../middleware/validation';

interface AdminRouterDeps {
  intentsClient: IIntentsServiceClient;
}

/**
 * Intent administration. The catalog lives in intents-service: these routes
 * only forward the request together with the caller's JWT (the service enforces
 * WRITE/ADMIN itself) and keep the gateway's public contract unchanged.
 */
export function createAdminRouter({ intentsClient }: AdminRouterDeps): Router {
  const router = Router();

  const reply = (res: Response, result: IntentsAdminResult, successStatus: number): void => {
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }
    res.status(successStatus).json({ ok: true, ...(result.intent ? { intent: result.intent } : {}) });
  };

  // authenticate has already run (app-level guard), so a token is always present.
  const tokenOf = (req: Request): string => extractAccessToken(req) ?? '';

  router.get('/api/admin/intents', async (_req: Request, res: Response) => {
    try {
      const intents = await intentsClient.list();
      res.status(200).json({ ok: true, intents });
    } catch {
      res.status(500).json({ ok: false, error: 'Failed to fetch intents' });
    }
  });

  router.post('/api/admin/intents', validateCreateIntentBody, async (req: Request, res: Response) => {
    const { intent, initialStep, keywords, description } = req.createIntentPayload!;
    const result = await intentsClient.create(tokenOf(req), {
      intent,
      initialStep,
      keywords,
      ...(description ? { description } : {}),
    });
    reply(res, result, 201);
  });

  router.put('/api/admin/intents/:intent', validateUpdateIntentBody, async (req: Request, res: Response) => {
    const { initialStep, keywords, description } = req.updateIntentPayload!;
    const result = await intentsClient.update(tokenOf(req), String(req.params.intent), {
      initialStep,
      ...(keywords !== undefined ? { keywords } : {}),
      ...(description ? { description } : {}),
    });
    reply(res, result, 200);
  });

  router.delete(
    '/api/admin/intents/:intent',
    requirePermission('ADMIN'),
    async (req: Request, res: Response) => {
      const result = await intentsClient.remove(tokenOf(req), String(req.params.intent));
      reply(res, result, 200);
    },
  );

  return router;
}
