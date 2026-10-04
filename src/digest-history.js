import { chmod, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const ID = /^dig_[A-Za-z0-9_-]{16,64}$/;
const MAX_RECORD_BYTES = 2_000_000;
const MAX_PAGE_SIZE = 50;
const KEEP_DAYS = 180;
const normalizedArticleUrl = (value) => {
  try { const url = new URL(value); url.hash = ''; if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, ''); return url.href; }
  catch { return String(value); }
};

function mergeRetryResult(previous, retry, sourceUrls) {
  const articles = new Map((previous.articles || []).map((article) => [normalizedArticleUrl(article.url), article]));
  for (const article of retry.articles || []) {
    const key = normalizedArticleUrl(article.url);
    if (!articles.has(key)) articles.set(key, article);
  }
  const candidates = [...articles.values()];
  const sources = new Map((previous.sources || []).map((source) => [source.url, source]));
  for (const source of retry.sources || []) sources.set(source.url, source);
  const researchSources = new Map((previous.researchSources || []).map((source) => [source.url, source]));
  for (const source of retry.researchSources || []) researchSources.set(source.url, source);
  const candidateUrls = new Set(candidates.map((article) => normalizedArticleUrl(article.url)));
  const automaticDigestUrls = [...new Set([...(previous.automaticDigestUrls || []), ...(retry.automaticDigestUrls || [])])]
    .filter((url) => candidateUrls.has(normalizedArticleUrl(url)));
  return { ...previous, articles: candidates, automaticDigestUrls, sources: [...sources.values()], researchSources: [...researchSources.values()], retryUpdatedSources: sourceUrls };
}

export class HistoryConflictError extends Error {
  constructor() { super('history_revision_conflict'); this.code = 'history_revision_conflict'; }
}

export function createDigestHistory(directory) {
  let writeQueue = Promise.resolve();
  const runtimeId = randomBytes(12).toString('base64url');
  const safePath = (id) => {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid digest id');
    return path.join(directory, `${id}.json`);
  };
  const read = async (id) => {
    let data;
    try { data = await readFile(safePath(id)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (data.byteLength > MAX_RECORD_BYTES) throw new Error('Digest history record exceeds size limit');
    try {
      const record = JSON.parse(data.toString('utf8'));
      if (record.id !== id || !Number.isSafeInteger(record.revision) || record.revision < 1
        || typeof record.createdAt !== 'string' || !record.snapshot || typeof record.snapshot !== 'object'
        || !record.result || typeof record.result !== 'object' || !Array.isArray(record.selectedUrls)
        || !Array.isArray(record.attempts) || !['queued', 'running', 'complete', 'error', 'interrupted'].includes(record.status)) {
        throw new Error('Invalid digest record');
      }
      return {
        ...record,
        status: ['queued', 'running'].includes(record.status) && record.runtimeId !== runtimeId ? 'interrupted' : record.status,
        attempts: (record.attempts || []).map((attempt) => ['queued', 'running'].includes(attempt.status) && attempt.runtimeId !== runtimeId
          ? { ...attempt, status: 'interrupted', interruptedAt: new Date().toISOString() }
          : attempt)
      };
    } catch { throw new Error(`Digest history record ${id} is corrupt`); }
  };
  const commit = async (record, expectedRevision) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const file = safePath(record.id);
    const previous = await read(record.id);
    if ((previous?.revision || 0) !== expectedRevision) throw new HistoryConflictError();
    const next = { ...record, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    const content = Buffer.from(JSON.stringify(next));
    if (content.byteLength > MAX_RECORD_BYTES) throw new Error('Digest history record exceeds size limit');
    const temp = path.join(directory, `.${record.id}.${randomBytes(8).toString('hex')}.tmp`);
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
    const dir = await open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
    return next;
  };
  const write = (record, expectedRevision) => {
    const operation = writeQueue.then(() => commit(record, expectedRevision));
    writeQueue = operation.catch(() => {});
    return operation;
  };
  return {
    async create({ snapshot, result = { articles: [], automaticDigestUrls: [], sources: [], researchSources: [], tokenUsage: { available: false } }, selectedUrls = [], name = 'Без названия', editorialDraft = '', status = 'complete' }) {
      const now = new Date().toISOString();
      const record = {
        id: `dig_${randomBytes(18).toString('base64url')}`, revision: 0, createdAt: now, updatedAt: now,
        runtimeId, status,
        name: String(name).slice(0, 120), snapshot: structuredClone(snapshot), result: structuredClone(result),
        selectedUrls: [...new Set(selectedUrls)], editorialDraft: String(editorialDraft).slice(0, 20_000), attempts: []
      };
      return write(record, 0);
    },
    async get(id) {
      const record = await read(id);
      if (record && Date.now() - Date.parse(record.createdAt) > KEEP_DAYS * 86_400_000) {
        await this.remove(id, record.revision);
        return null;
      }
      return record;
    },
    async update(id, patch, expectedRevision) {
      const current = await this.get(id);
      if (!current) return null;
      const allowed = {};
      if (typeof patch.name === 'string') allowed.name = patch.name.trim().slice(0, 120);
      if (typeof patch.editorialDraft === 'string') allowed.editorialDraft = patch.editorialDraft.slice(0, 20_000);
      if (Array.isArray(patch.selectedUrls) && patch.selectedUrls.length <= 200) allowed.selectedUrls = [...new Set(patch.selectedUrls.filter((url) => typeof url === 'string').slice(0, 200))];
      if (!Object.keys(allowed).length) throw new Error('No valid editable fields');
      return write({ ...current, ...allowed }, expectedRevision);
    },
    async updateStatus(id, status) {
      const operation = writeQueue.then(async () => {
        const current = await read(id);
        if (!current) return null;
        return commit({ ...current, status, runtimeId }, current.revision);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    },
    async complete(id, result) {
      const operation = writeQueue.then(async () => {
        const current = await read(id);
        if (!current) return null;
        return commit({ ...current, result: structuredClone(result), status: 'complete', runtimeId }, current.revision);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    },
    async beginRetry(id, { submissionId, selectedSourceUrls }, expectedRevision) {
      const current = await this.get(id);
      if (!current) return null;
      const existing = current.attempts.find((attempt) => attempt.submissionId === submissionId);
      if (existing) return { record: current, attempt: existing, reused: true };
      const attempt = { id: `try_${randomBytes(12).toString('base64url')}`, submissionId, selectedSourceUrls: [...selectedSourceUrls], status: 'queued', runtimeId, jobId: null, createdAt: new Date().toISOString(), usage: { available: false }, error: null };
      const record = await write({ ...current, attempts: [...current.attempts, attempt] }, expectedRevision);
      return { record, attempt, reused: false };
    },
    async attachRetryJob(id, attemptId, jobId, status = 'queued') {
      const operation = writeQueue.then(async () => {
        const current = await read(id);
        if (!current) return null;
        const attempts = current.attempts.map((attempt) => attempt.id === attemptId ? { ...attempt, jobId, status } : attempt);
        return commit({ ...current, attempts }, current.revision);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    },
    async updateRetryStatus(id, attemptId, status) {
      const operation = writeQueue.then(async () => {
        const current = await read(id);
        if (!current) return null;
        const attempts = current.attempts.map((attempt) => attempt.id === attemptId ? { ...attempt, status } : attempt);
        return commit({ ...current, attempts }, current.revision);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    },
    async finishRetry(id, attemptId, { status, result, error }) {
      const operation = writeQueue.then(async () => {
        const current = await read(id);
        if (!current) return null;
        let completedAttempt;
        const attempts = current.attempts.map((attempt) => {
          if (attempt.id !== attemptId) return attempt;
          completedAttempt = { ...attempt, status, finishedAt: new Date().toISOString(), error: error || null,
            usage: result?.tokenUsage || { available: false }, result: result ? { researchSources: result.researchSources || [], foundCount: (result.articles || []).length } : null };
          return completedAttempt;
        });
        if (!completedAttempt) return null;
        const merged = status === 'complete' && result ? mergeRetryResult(current.result, result, completedAttempt.selectedSourceUrls) : current.result;
        return commit({ ...current, result: merged, attempts }, current.revision);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    },
    async list({ limit = 20, cursor } = {}) {
      const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.isInteger(limit) ? limit : 20));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const names = (await readdir(directory)).filter((name) => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).sort().reverse();
      const records = [];
      for (const name of names) {
        const record = await read(name.slice(0, -5));
        if (!record) continue;
        if (Date.now() - Date.parse(record.createdAt) > KEEP_DAYS * 86_400_000) {
          await unlink(safePath(record.id));
          continue;
        }
        records.push(record);
      }
      records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const cursorIndex = cursor ? records.findIndex((record) => record.id === cursor) : -1;
      if (cursor && cursorIndex < 0) {
        const error = new Error('Invalid history cursor');
        error.code = 'invalid_history_cursor';
        throw error;
      }
      const start = cursor ? cursorIndex + 1 : 0;
      const items = records.slice(start, start + pageSize).map(({ id, revision, createdAt, updatedAt, name, snapshot, result, selectedUrls, editorialDraft, attempts, status }) => ({ id, revision, createdAt, updatedAt, name, snapshot, result, selectedUrls, editorialDraft, attempts, status }));
      return { items, nextCursor: start + pageSize < records.length ? items.at(-1)?.id || null : null };
    },
    remove(id, expectedRevision) {
      const operation = writeQueue.then(async () => {
        const current = await read(id);
        if (!current) return false;
        if (current.revision !== expectedRevision) throw new HistoryConflictError();
        await unlink(safePath(id));
        return true;
      });
      writeQueue = operation.catch(() => {});
      return operation;
    }
  };
}
