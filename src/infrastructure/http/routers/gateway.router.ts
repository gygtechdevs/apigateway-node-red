import { Router, type Request, type Response } from 'express';
import { logInfo, logError } from '../../../shared/logger';
import type { JsonObject } from '../../../shared/types';
import type { IIntentsCatalog } from '../../../application/ports/IIntentsServiceClient';
import type { RouteMessageUseCase } from '../../../application/gateway/RouteMessageUseCase';
import { parseNodeRedReply } from '../../../application/gateway/nodeRedReply';
import type { IGraphClient } from '../../../application/ports/IGraphClient';
import type { IDedupeStore } from '../../../application/ports/IDedupeStore';
import { authenticate } from '../middleware/auth';
import { normalizeGatewayBody } from '../middleware/validation';
import {
  createMetaChallengeHandler,
  createMetaSignatureMiddleware,
} from '../../meta/metaWebhookVerification';
import { parseMetaInbound, textBody } from '../../meta/MetaInboundParser';

/** Time budget for Node-RED when serving a Meta webhook. */
export const WEBHOOK_NODE_RED_TIMEOUT_MS = 8000;

export interface MetaWebhookConfig {
  appSecret: string;
  verifyToken: string;
  /** Fallback sender number when the inbound payload carries no phone_number_id. */
  phoneNumberId?: string | undefined;
}

interface GatewayRouterDeps {
  intentsCatalog: IIntentsCatalog;
  routeMessageUseCase: RouteMessageUseCase;
  graphClient: IGraphClient;
  dedupeStore: IDedupeStore;
  meta: MetaWebhookConfig;
}

export function createGatewayRouter(deps: GatewayRouterDeps): Router {
  const { intentsCatalog, routeMessageUseCase, graphClient, dedupeStore, meta } = deps;
  const router = Router();

  // ── JWT-protected JSON API ──────────────────────────────────────────────────

  router.get('/api/gateway/intents', authenticate, async (_req: Request, res: Response) => {
    try {
      const intents = await intentsCatalog.list();
      res.status(200).json({ ok: true, intents });
    } catch {
      res.status(500).json({ ok: false, error: 'Failed to fetch intents' });
    }
  });

  router.post(
    '/api/gateway/message',
    authenticate,
    normalizeGatewayBody,
    async (req: Request, res: Response) => {
      const body = req.body as JsonObject;

      logInfo('gateway_message.incoming', {
        method: req.method,
        url: req.url,
        bodyKeys: Object.keys(body),
      });

      const result = await routeMessageUseCase.execute({
        body,
        fallbackStep: process.env.GATEWAY_FALLBACK_STEP,
      });

      if (!result.ok) {
        if (result.code === 'MISSING_TEXT') {
          res.status(400).json({
            ok: false,
            error:
              'Text is required in requirementsText, text, message.text, payload.text or payload.intentText',
          });
          return;
        }
        if (result.code === 'NO_INTENT') {
          res.status(422).json({ ok: false, error: 'No intent detected and no fallback configured' });
          return;
        }
        logError('gateway_message.unhandled_error', result.error, { route: req.path });
        res.status(500).json({
          ok: false,
          error: result.error instanceof Error ? result.error.message : 'Unexpected gateway error',
        });
        return;
      }

      res.locals.intent = result.intent ?? 'fallback';
      res.locals.routedStep = result.routedStep;

      const reply = parseNodeRedReply(result.nodeRedData, result.nodeRedRawText);
      res.status(result.nodeRedStatus).json({
        ok: result.nodeRedStatus >= 200 && result.nodeRedStatus < 300,
        intent: result.intent,
        routedStep: result.routedStep,
        graphApiPayload: reply.graphApiPayload,
        replyText: reply.replyText,
      });
    },
  );

  // ── WhatsApp Cloud API webhook (Meta) ───────────────────────────────────────

  router.get('/webhooks/whatsapp', createMetaChallengeHandler(meta.verifyToken));

  router.post(
    '/webhooks/whatsapp',
    createMetaSignatureMiddleware(meta.appSecret),
    async (req: Request, res: Response) => {
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse((req.rawBody ?? Buffer.alloc(0)).toString('utf8'));
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid JSON body' });
        return;
      }

      const message = parseMetaInbound(parsedBody);
      if (!message) {
        // Status updates and other non-message events: acknowledge, nothing to do.
        res.sendStatus(200);
        return;
      }

      const claimed = await dedupeStore.claim(message.messageId).catch((error: unknown) => {
        // Fail open: a dedupe outage must not drop customer messages.
        logError('meta_webhook.dedupe_unavailable', error, { messageId: message.messageId });
        return true;
      });
      if (!claimed) {
        logInfo('meta_webhook.duplicate_ignored', { messageId: message.messageId });
        res.sendStatus(200);
        return;
      }

      const release = async (): Promise<void> => {
        await dedupeStore.release(message.messageId).catch(() => undefined);
      };

      const text = textBody(message);
      if (!text) {
        logInfo('meta_webhook.no_text', { messageId: message.messageId, type: message.type });
        res.sendStatus(200);
        return;
      }

      try {
        const result = await routeMessageUseCase.execute({
          body: {
            text,
            conversationId: message.from,
            source: 'whatsapp',
            from: { id: message.from },
            message: { id: message.messageId },
            metadata: { channel: 'whatsapp' },
          },
          fallbackStep: process.env.GATEWAY_FALLBACK_STEP,
          timeoutMs: WEBHOOK_NODE_RED_TIMEOUT_MS,
        });

        if (!result.ok) {
          if (result.code === 'INTERNAL') {
            await release();
            res.sendStatus(502);
            return;
          }
          // MISSING_TEXT / NO_INTENT: retrying cannot help.
          res.sendStatus(200);
          return;
        }

        if (!result.nodeRedStatus || result.nodeRedStatus >= 400) {
          await release();
          res.sendStatus(502);
          return;
        }

        const reply = parseNodeRedReply(result.nodeRedData, result.nodeRedRawText);
        let payload = reply.graphApiPayload;
        if (!payload && reply.replyText) {
          payload = { type: 'text', text: { body: reply.replyText } };
        }
        if (!payload) {
          logInfo('meta_webhook.no_reply', { messageId: message.messageId });
          res.sendStatus(200);
          return;
        }

        const outbound: Record<string, unknown> = {
          messaging_product: 'whatsapp',
          to: message.from,
          ...payload,
        };

        const phoneNumberId = message.phoneNumberId ?? meta.phoneNumberId;
        if (!phoneNumberId) {
          logError('meta_webhook.missing_phone_number_id', new Error('No phone_number_id'), {
            messageId: message.messageId,
          });
          res.sendStatus(200);
          return;
        }

        const sent = await graphClient.send(phoneNumberId, outbound);
        if (!sent.ok) {
          logError('meta_webhook.graph_send_failed', new Error(`Graph status ${sent.status}`), {
            messageId: message.messageId,
            status: sent.status,
          });
          await release();
          res.sendStatus(502);
          return;
        }

        res.sendStatus(200);
      } catch (error) {
        logError('meta_webhook.unhandled_error', error, { messageId: message.messageId });
        await release();
        res.sendStatus(502);
      }
    },
  );

  return router;
}
