"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
/**
 * Middleware to protect sensitive routes.
 * Expects the key in the 'x-auth' header.
 */
function requireAuth(req, res, next) {
    const key = req.headers['x-auth'];
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey || key !== adminKey) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
}
