import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

declare global {
  namespace Express {
    interface Request {
      /** Raw request body, captured only for /webhooks/whatsapp*. */
      rawBody?: Buffer;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Validates "sha256=<hex>" = HMAC_SHA256(rawBody, appSecret) in constant time. */
export function isValidMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(signatureHeader, expected);
}

/**
 * Captures the raw body for webhook routes. Mounted after express.raw() and
 * BEFORE express.json(), only on /webhooks/whatsapp*.
 */
export const captureRawBody: RequestHandler = (req, _res, next) => {
  req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  next();
};

/** GET /webhooks/whatsapp: resolves Meta's subscription challenge. */
export function createMetaChallengeHandler(verifyToken: string): RequestHandler {
  return (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      typeof token === 'string' &&
      typeof challenge === 'string' &&
      verifyToken &&
      safeEqual(token, verifyToken)
    ) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).json({ ok: false, error: 'Verification failed' });
  };
}

/** POST /webhooks/whatsapp: rejects with 403 unless X-Hub-Signature-256 is valid. */
export function createMetaSignatureMiddleware(appSecret: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.header('x-hub-signature-256');
    if (!req.rawBody || !isValidMetaSignature(req.rawBody, signature, appSecret)) {
      res.status(403).json({ ok: false, error: 'Invalid signature' });
      return;
    }
    next();
  };
}
