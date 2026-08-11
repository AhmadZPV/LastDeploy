import crypto from 'node:crypto';

const TOKEN_BYTES = 32;

export function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  return req.session.csrfToken;
}

export function csrfProtection(req, res, next) {
  const token = csrfToken(req);
  res.locals = res.locals || {};
  res.locals.csrfToken = token;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const supplied = req.body?._csrf || req.get('x-csrf-token') || req.get('x-xsrf-token');
  const suppliedBuffer = Buffer.from(String(supplied || ''));
  const tokenBuffer = Buffer.from(token);
  const valid = suppliedBuffer.length === tokenBuffer.length
    && crypto.timingSafeEqual(suppliedBuffer, tokenBuffer);
  if (!valid) {
    if (req.path.startsWith('/ajax') || req.is('application/json')) {
      return res.status(403).json({ success: false, error: 'Ungültiges CSRF-Token' });
    }
    return res.status(403).render('error', { message: 'Ungültiges CSRF-Token' });
  }
  next();
}

export default { csrfToken, csrfProtection };
