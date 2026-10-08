import type { Request, Response, NextFunction } from 'express';

/** Requires a valid JWT (verified earlier by JwtVerifierMiddleware). */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}

/** Requires at least one of the given permissions in req.auth.permissions. */
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    if (!permissions.some((p) => req.auth!.permissions.includes(p))) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
    next();
  };
}
