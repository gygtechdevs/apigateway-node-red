import type { JsonObject } from '../shared/types';

export function getStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getObjectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function resolveConversationId(body: unknown): string {
  const safeBody = getObjectValue(body) || {};
  return (
    getStringValue(safeBody.conversationId) ||
    getStringValue(safeBody.sessionId) ||
    'unknown'
  );
}

export function resolveSessionUserId(body: unknown): string {
  const safeBody = getObjectValue(body) || {};
  const safeSession = getObjectValue(safeBody.session) || {};
  const safeFrom = getObjectValue(safeBody.from) || {};

  return (
    getStringValue(safeSession.userId) ||
    getStringValue(safeFrom.id) ||
    getStringValue(safeBody.userId) ||
    'unknown'
  );
}

export function resolveUserTextFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const safeBody = body as JsonObject;
  const payload = getObjectValue(safeBody.payload);

  const fromRequirementsText = getStringValue(safeBody.requirementsText);
  if (fromRequirementsText) return fromRequirementsText;

  const fromText = getStringValue(safeBody.text);
  if (fromText) return fromText;

  const message = getObjectValue(safeBody.message);
  const fromMessage = message ? getStringValue(message.text) : null;
  if (fromMessage) return fromMessage;

  const fromPayloadText = payload ? getStringValue(payload.text) : null;
  if (fromPayloadText) return fromPayloadText;

  const fromPayloadIntentText = payload ? getStringValue(payload.intentText) : null;
  if (fromPayloadIntentText) return fromPayloadIntentText;

  return null;
}

export function buildNodeRedBody(
  body: unknown,
  text: string,
): Record<string, unknown> {
  const safeBody = getObjectValue(body) || {};
  const safeSession = getObjectValue(safeBody.session) || {};
  const safePayload = getObjectValue(safeBody.payload) || {};
  const safeFrom = getObjectValue(safeBody.from) || {};
  const safeTo = getObjectValue(safeBody.to) || {};
  const safeMessage = getObjectValue(safeBody.message) || {};
  const metadata = getObjectValue(safeBody.metadata) || {};

  const conversationId =
    getStringValue(safeBody.conversationId) ||
    getStringValue(safeBody.sessionId) ||
    'anonymous-conversation';

  const userId =
    getStringValue(safeSession.userId) ||
    getStringValue(safeFrom.id) ||
    getStringValue(safeBody.userId) ||
    'anonymous';

  const channel =
    getStringValue(safeSession.channel) ||
    getStringValue(metadata.channel) ||
    'whatsapp';

  const payload: Record<string, unknown> = { ...safePayload };

  if (!Object.prototype.hasOwnProperty.call(payload, 'text') && text) {
    payload.text = text;
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'source')) {
    payload.source = getStringValue(safeBody.source) || 'gateway';
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'messageId')) {
    const messageId = getStringValue(safeMessage.id);
    if (messageId) payload.messageId = messageId;
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'from')) {
    payload.from = {
      id: getStringValue(safeFrom.id) || userId,
      name: getStringValue(safeFrom.name) || null,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'to')) {
    payload.to = {
      id: getStringValue(safeTo.id) || null,
      name: getStringValue(safeTo.name) || null,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'sentAt')) {
    payload.sentAt = Number(safeBody.sentAt || safeMessage.timestamp || Date.now());
  }

  return {
    conversationId,
    session: { userId, channel },
    payload,
  };
}
