import { resolveUserTextFromBody, resolveConversationId, buildNodeRedBody } from '../../domain/bodyNormalizer';
import { logInfo, logError } from '../../shared/logger';
import type { IIntentClassifier } from '../ports/IIntentsServiceClient';
import type { INodeRedClient } from '../ports/INodeRedClient';
import type { JsonObject } from '../../shared/types';

export interface RouteMessageInput {
  body: JsonObject;
  fallbackStep: string | undefined;
  /** Timeout for the Node-RED call; defaults to NODE_RED_TIMEOUT_MS. */
  timeoutMs?: number;
}

export type RouteMessageResult =
  | {
      ok: true;
      intent: string | null;
      routedStep: string;
      nodeRedStatus: number;
      nodeRedData: unknown;
      nodeRedRawText: string | undefined;
    }
  | { ok: false; code: 'MISSING_TEXT'; conversationId: string }
  | { ok: false; code: 'NO_INTENT'; conversationId: string }
  | { ok: false; code: 'INTERNAL'; error: unknown };

export class RouteMessageUseCase {
  constructor(
    private intentClassifier: IIntentClassifier,
    private nodeRedClient: INodeRedClient,
  ) {}

  async execute(input: RouteMessageInput): Promise<RouteMessageResult> {
    const { body, fallbackStep } = input;

    const text = resolveUserTextFromBody(body);
    const conversationId = resolveConversationId(body);

    if (!text) {
      logInfo('gateway_message.validation_failed', {
        reason: 'missing_text',
        conversationId,
        bodyKeys: Object.keys(body),
      });
      return { ok: false, code: 'MISSING_TEXT', conversationId };
    }

    try {
      // Classification is delegated to intents-service; the gateway only orchestrates.
      const detection = await this.intentClassifier.detect(text);

      logInfo('gateway_message.detected_intent', {
        inputText: text,
        detectedIntent: detection ? detection.intent : null,
        matchedKeywords: detection ? detection.matchedKeywords : [],
      });

      logInfo('gateway_message.intent_resolved', {
        conversationId,
        intent: detection ? detection.intent : null,
        confidence: detection ? detection.confidence : 0,
        hasFallback: Boolean(fallbackStep),
      });

      if (!detection && !fallbackStep) {
        logInfo('gateway_message.no_intent_no_fallback', { conversationId });
        return { ok: false, code: 'NO_INTENT', conversationId };
      }

      const targetStep = (detection ? detection.initialStep : fallbackStep) as string;
      const payload = buildNodeRedBody(body, text);

      logInfo('gateway_message.nodered_invoke_start', {
        conversationId: payload.conversationId as string,
        intent: detection ? detection.intent : 'fallback',
        targetStep,
      });

      const startedAt = Date.now();
      const nodeRedResult = await this.nodeRedClient.post(
        targetStep,
        payload,
        input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined,
      );

      if (!nodeRedResult.ok) {
        logError(
          'gateway_message.nodered_http_error',
          new Error(`Node-RED status ${nodeRedResult.status}`),
          {
            conversationId: payload.conversationId as string,
            targetStep,
            status: nodeRedResult.status,
          },
        );
      } else {
        logInfo('gateway_message.nodered_invoke_success', {
          conversationId: payload.conversationId as string,
          status: nodeRedResult.status,
          durationMs: Date.now() - startedAt,
        });
      }

      return {
        ok: true,
        intent: detection ? detection.intent : null,
        routedStep: targetStep,
        nodeRedStatus: nodeRedResult.status,
        nodeRedData: nodeRedResult.data,
        nodeRedRawText: nodeRedResult.rawText as string | undefined,
      };
    } catch (error) {
      logError('gateway_message.unhandled_error', error, {});
      return { ok: false, code: 'INTERNAL', error };
    }
  }
}
