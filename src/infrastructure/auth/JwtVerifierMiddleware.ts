import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface AuthContext {
  sub: string;
  email: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const ACCESS_TOKEN_COOKIE = 'access_token';

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function extractAccessToken(req: Request): string | null {
  const authorization = req.header('authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1];
  }
  return readCookie(req.headers.cookie, ACCESS_TOKEN_COOKIE);
}

export function verifyAccessToken(token: string, secret: string): AuthContext | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') return null;

    const permissions = Array.isArray(decoded.permissions)
      ? (decoded.permissions as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];

    return {
      sub: decoded.sub,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      permissions,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the HS256 access token locally (no call to auth-service) and injects
 * req.auth. It never rejects: enforcement lives in `authenticate`.
 */
export function createJwtVerifierMiddleware(secret: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractAccessToken(req);
    if (token) {
      const auth = verifyAccessToken(token, secret);
      if (auth) req.auth = auth;
    }
    next();
  };
}
