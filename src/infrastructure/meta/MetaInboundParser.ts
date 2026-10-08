export interface MetaInboundMessage {
  messageId: string;
  from: string;
  phoneNumberId: string | null;
  type: string;
  /** The raw message object as sent by Meta (text, interactive, image, ...). */
  raw: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Extracts the first inbound message from a Meta webhook payload
 * (entry[].changes[].value.messages[0]). Returns null for payloads without
 * messages (delivery/read status updates, malformed bodies).
 */
export function parseMetaInbound(body: unknown): MetaInboundMessage | null {
  const root = asObject(body);
  const entries = Array.isArray(root?.entry) ? (root.entry as unknown[]) : [];

  for (const entry of entries) {
    const changes = asObject(entry)?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = asObject(asObject(change)?.value);
      const messages = value?.messages;
      if (!value || !Array.isArray(messages) || messages.length === 0) continue;

      const message = asObject(messages[0]);
      const messageId = asString(message?.id);
      const from = asString(message?.from);
      if (!message || !messageId || !from) continue;

      return {
        messageId,
        from,
        phoneNumberId: asString(asObject(value.metadata)?.phone_number_id),
        type: asString(message.type) ?? 'unknown',
        raw: message,
      };
    }
  }

  return null;
}

/** Text used for intent detection. Empty string when the message carries no text. */
export function textBody(message: MetaInboundMessage): string {
  const raw = message.raw;

  const text = asString(asObject(raw.text)?.body);
  if (text) return text;

  const interactive = asObject(raw.interactive);
  const buttonId = asString(asObject(interactive?.button_reply)?.id);
  if (buttonId) return buttonId;
  const listId = asString(asObject(interactive?.list_reply)?.id);
  if (listId) return listId;

  for (const mediaType of ['image', 'video', 'document']) {
    const caption = asString(asObject(raw[mediaType])?.caption);
    if (caption) return caption;
  }

  return '';
}
