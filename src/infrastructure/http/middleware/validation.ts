import type { Request, Response, NextFunction } from 'express';
import { getStringValue } from '../../../domain/bodyNormalizer';
import type { JsonObject } from '../../../shared/types';

// ── Parsed payload shapes ──────────────────────────────────────────────────

export interface CreateIntentPayload {
  intent: string;
  initialStep: string;
  keywords: string[];
  description?: string;
}

export interface UpdateIntentPayload {
  initialStep: string;
  keywords?: string[];
  description?: string;
}

export interface NodeDeletedEventPayload {
  event: string;
  node_id: string;
  node_type: string;
  node_name: string;
  flow_id: string;
  timestamp: string;
}

// ── Express Request augmentation ──────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      createIntentPayload?: CreateIntentPayload;
      updateIntentPayload?: UpdateIntentPayload;
      nodeDeletedEvent?: NodeDeletedEventPayload;
    }
  }
}

// ── Middleware functions ───────────────────────────────────────────────────

export function validateCreateIntentBody(req: Request, res: Response, next: NextFunction): void {
  const body = (req.body || {}) as JsonObject;
  const intent = getStringValue(body.intent) ?? '';
  const initialStep = getStringValue(body.initialStep) ?? '';
  const rawKeywords = body.keywords;
  const keywords = Array.isArray(rawKeywords)
    ? (rawKeywords as unknown[])
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        .map((k) => k.trim())
    : [];
  const description = getStringValue(body.description);

  if (!intent) {
    res.status(400).json({ ok: false, error: 'Field "intent" is required.' });
    return;
  }

  if (!initialStep) {
    res.status(400).json({ ok: false, error: 'Field "initialStep" is required.' });
    return;
  }

  req.createIntentPayload = {
    intent,
    initialStep,
    keywords,
    ...(description ? { description } : {}),
  };

  next();
}

export function validateUpdateIntentBody(req: Request, res: Response, next: NextFunction): void {
  const body = (req.body || {}) as JsonObject;
  const initialStep = getStringValue(body.initialStep) ?? '';
  const rawKeywords = body.keywords;
  const keywords = Array.isArray(rawKeywords)
    ? (rawKeywords as unknown[])
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        .map((k) => k.trim())
    : undefined;
  const description = getStringValue(body.description);

  if (!initialStep) {
    res.status(400).json({ ok: false, error: 'Field "initialStep" is required.' });
    return;
  }

  req.updateIntentPayload = {
    initialStep,
    ...(keywords !== undefined ? { keywords } : {}),
    ...(description ? { description } : {}),
  };

  next();
}

export function validateNodeDeletedEvent(req: Request, res: Response, next: NextFunction): void {
  const body = (req.body || {}) as JsonObject;
  const event = getStringValue(body.event);
  const nodeId = getStringValue(body.node_id);
  const nodeType = getStringValue(body.node_type);
  const nodeName = getStringValue(body.node_name);
  const flowId = getStringValue(body.flow_id);
  const timestamp = getStringValue(body.timestamp);

  const INVALID_BODY_ERROR =
    'Invalid body. Expected event=node_deleted and string fields node_id, node_type, node_name, flow_id, timestamp.';

  if (!event || !nodeId || !nodeType || !flowId || !timestamp) {
    res.status(400).json({ ok: false, error: INVALID_BODY_ERROR });
    return;
  }

  if (event !== 'node_deleted') {
    res.status(400).json({ ok: false, error: INVALID_BODY_ERROR });
    return;
  }

  if (!/^\d+$/.test(timestamp)) {
    res.status(400).json({ ok: false, error: INVALID_BODY_ERROR });
    return;
  }

  req.nodeDeletedEvent = {
    event,
    node_id: nodeId,
    node_type: nodeType,
    node_name: nodeName ?? '',
    flow_id: flowId,
    timestamp,
  };

  next();
}

export function normalizeGatewayBody(req: Request, _res: Response, next: NextFunction): void {
  let body = (req.body ?? {}) as JsonObject;

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body as unknown as string) as JsonObject;
    } catch {
      /* keep string body as-is */
    }
  }

  if (body.Body && !body.text) {
    body.text = body.Body;
  }

  req.body = body;
  next();
}
