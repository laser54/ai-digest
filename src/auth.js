import { timingSafeEqual } from 'node:crypto';

// Encode the credential bytes as hex so both sides are the same length for
// `timingSafeEqual`. This removes the early-return-on-length-difference leak
// that raw `timingSafeEqual` has for unequal-length inputs. The encoder is
// not a cryptographic hash; it is the byte-representation step that makes
// the comparison length-stable.
const hexEncode = (value) => Buffer.from(value).toString('hex');

function getProvidedPassword(req) {
  // Prefer the body form, which is not bound to HTTP header byte restrictions
  // (ISO-8859-1) and is the only path that lets the user use a non-ASCII
  // (e.g. Cyrillic, emoji) ADMIN_PASSWORD.
  //
  // Body-wins contract: if BOTH the body field and the legacy header are
  // present and disagree, the body wins. The header is a legacy-only
  // backwards-compatibility path; new clients (the bundled UI, automation
  // scripts) must send executionPassword in the body.
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
  const expectedHex = hexEncode(password);

  return (req, res, next) => {
    const provided = getProvidedPassword(req);
    if (provided === null) {
      res.status(401).json({ error: 'Введите пароль для запуска AI-отбора.' });
      return;
    }
    const actualHex = hexEncode(provided);
    if (actualHex.length !== expectedHex.length || !timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'))) {
      res.status(401).json({ error: 'Введите пароль для запуска AI-отбора.' });
      return;
    }
    next();
  };
}
