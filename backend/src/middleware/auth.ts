import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to protect sensitive routes.
 * Expects the key in the 'x-auth' header.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-auth'] as string;
  const adminKey = process.env.ADMIN_KEY;

  if (!adminKey || key !== adminKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}
