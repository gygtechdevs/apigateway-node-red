export interface NodeRedReply {
  /** Payload for the WhatsApp Graph API, as built by Node-RED (step-close). */
  graphApiPayload: Record<string, unknown> | null;
  /** Plain-text rendering of the reply, for simulators and logs. */
  replyText: string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractReplyText(data: Record<string, unknown>, graphApiPayload: Record<string, unknown> | null): string | null {
  const answerText = asObject(data.answerContext)?.answerText;
  if (typeof answerText === 'string') return answerText;

  const textBody = asObject(data.text)?.body;
  if (typeof textBody === 'string') return textBody;
  if (typeof data.text === 'string') return data.text;

  const payloadBody = asObject(graphApiPayload?.text)?.body;
  if (typeof payloadBody === 'string') return payloadBody;

  return null;
}

/** Reads the Node-RED response (parsed JSON, or raw text) into the gateway reply shape. */
export function parseNodeRedReply(data: unknown, rawText: string | undefined): NodeRedReply {
  let source: unknown = data;

  if (!asObject(source) && typeof rawText === 'string' && rawText.trim()) {
    try {
      source = JSON.parse(rawText) as unknown;
    } catch {
      return { graphApiPayload: null, replyText: rawText };
    }
  }

  const obj = asObject(source);
  if (!obj) return { graphApiPayload: null, replyText: null };

  const graphApiPayload = asObject(obj.graphApiPayload);
  return { graphApiPayload, replyText: extractReplyText(obj, graphApiPayload) };
}
