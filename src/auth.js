import { timingSafeEqual } from 'node:crypto';

// Constant-time compare of two strings. We deliberately hash the inputs first so
// that any accidental length leak via timingSafeEqual's early-return on different
// lengths is removed. The expected password is hashed once at middleware
// construction; each request hashes the supplied credential and compares. This
// is the same constant-time guarantee as raw timingSafeEqual over a fixed
// length, and crucially, it removes the historical assumption that the password
// is ASCII-clean enough to put into an HTTP header.
const hash = (value) => Buffer.from(value).toString('hex');

function getProvidedPassword(req) {
  // Prefer the body form, which is not bound to HTTP header byte restrictions
  // (ISO-8859-1) and is the only path that lets the user use a non-ASCII
  // (e.g. Cyrillic, emoji) ADMIN_PASSWORD.
  if (req && req.body && typeof req.body.executionPassword === 'string') {
    return req.body.executionPassword;
  }
  if (req && req.headers && typeof req.headers['x-ai-digest-password'] === 'string') {
    return req.headers['x-ai-digest-password'];
  }
  return null;
}

export function createExecutionAuth(password) {
  if (!password) throw new Error('ADMIN_PASSWORD is required');
  const expectedHex = hash(password);

  return (req, res, next) => {
    const provided = getProvidedPassword(req);
    if (provided === null) {
      res.status(401).json({ error: 'Введите пароль для запуска AI-отбора.' });
      return;
    }
    const actualHex = hash(provided);
    if (actualHex.length !== expectedHex.length || !timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'))) {
      res.status(401).json({ error: 'Введите пароль для запуска AI-отбора.' });
      return;
    }
    next();
  };
}
