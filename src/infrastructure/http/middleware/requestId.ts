import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getStringValue } from '../../../domain/bodyNormalizer';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inboundRequestId = getStringValue(req.header('x-request-id'));
  req.requestId = inboundRequestId || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
