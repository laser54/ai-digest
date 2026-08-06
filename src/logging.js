import { randomUUID } from 'node:crypto';

const MAX_STRING_LENGTH = 4096;

export function generateRequestId() {
  return `req_${randomUUID()}`;
}

export function sanitizeUrl(value) {
  if (typeof value !== 'string') return 'invalid-url';
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return 'invalid-url';
  }
}

function looksLikeUrlWithCredentials(value) {
  if (typeof value !== 'string') return false;
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

const SENSITIVE_KEYS = new Set([
  'password',
  'admin_password',
  'x-ai-digest-password',
  'x-execution-auth',
  'authorization',
  'cookie',
  'token',
  'secret',
  'secretkey',
  'api_key',
  'apikey',
  'html',
  'prompt',
  'finalresponse',
  'response',
  'body',
  'error',
  'errors',
  'details',
  'context',
  'payload',
  'message'
]);

export function sanitizeLogValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
    }
    if (looksLikeUrlWithCredentials(value)) {
      return sanitizeUrl(value);
    }
    return value;
  }
  return value;
}

export function sanitizeLogObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeLogValue(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeLogObject);

  const cleaned = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      cleaned[key] = '[REDACTED]';
    } else if (lowerKey === 'sourceurl' && typeof val === 'string') {
      cleaned[key] = sanitizeUrl(val);
    } else if (typeof val === 'object' && val !== null) {
      cleaned[key] = sanitizeLogObject(val);
    } else {
      cleaned[key] = sanitizeLogValue(val);
    }
  }
  return cleaned;
}

export class AuditLogger {
  constructor({ requestId = generateRequestId(), writer = (line) => console.log(line) } = {}) {
    this.requestId = requestId;
    this.writer = writer;
  }

  log(level, event, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      requestId: this.requestId,
      ...sanitizeLogObject(data)
    };
    this.writer(JSON.stringify(entry));
  }

  info(event, data) {
    this.log('info', event, data);
  }

  error(event, data) {
    this.log('error', event, data);
  }

  warn(event, data) {
    this.log('warn', event, data);
  }
}
