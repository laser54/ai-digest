import { timingSafeEqual } from 'node:crypto';

export function createBasicAuth(password) {
  if (!password) throw new Error('ADMIN_PASSWORD is required');
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const encoded = header.startsWith('Basic ') ? header.slice(6) : '';
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const supplied = separator >= 0 ? decoded.slice(separator + 1) : '';
    const expected = Buffer.from(password);
    const actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="AI Digest"').end();
      return;
    }
    next();
  };
}
