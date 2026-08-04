import { timingSafeEqual } from 'node:crypto';

export function createExecutionAuth(password) {
  if (!password) throw new Error('ADMIN_PASSWORD is required');
  return (req, res, next) => {
    const expected = Buffer.from(password);
    const actual = Buffer.from(req.headers['x-ai-digest-password'] || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'Введите пароль для запуска AI-отбора.' });
      return;
    }
    next();
  };
}
