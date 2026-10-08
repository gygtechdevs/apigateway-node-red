import { Router, type Request, type Response } from 'express';
import { buildNodeRedUrl } from '../../nodeRed/NodeRedClientAdapter';
import { extractStepsFromPayload } from '../../../domain/stepsParser';
import { logError } from '../../../shared/logger';

export function createStepsRouter(): Router {
  const router = Router();

  router.get('/api/steps', async (_req: Request, res: Response) => {
    const stepsBaseUrl = process.env.STEPS_SERVICE_BASE_URL || 'http://localhost:3000';
    const stepsUrl = buildNodeRedUrl(stepsBaseUrl, '/api/steps');
    const timeoutMs = Number(process.env.NODE_RED_TIMEOUT_MS || 10000);

    try {
      const response = await fetch(stepsUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const rawText = await response.text();
      const contentType = response.headers.get('content-type') || '';
      let data: unknown = null;

      if (rawText) {
        if (contentType.includes('application/json')) {
          data = JSON.parse(rawText) as unknown;
        } else {
          try {
            data = JSON.parse(rawText) as unknown;
          } catch {
            data = null;
          }
        }
      }

      if (!response.ok) {
        logError(
          'steps_catalog.upstream_error',
          new Error(`Steps service status ${response.status}`),
          { stepsUrl, status: response.status },
        );
        res.status(response.status).json({
          ok: false,
          error: `Could not fetch steps from the upstream service (${response.status})`,
        });
        return;
      }

      const steps = extractStepsFromPayload(data);
      res.status(200).json({ ok: true, steps });
    } catch (error) {
      logError('steps_catalog.unhandled_error', error, { stepsUrl });
      res.status(502).json({
        ok: false,
        error: 'Could not query /api/steps on the upstream service',
      });
    }
  });

  return router;
}
