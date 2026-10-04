import { createHash, randomBytes } from 'node:crypto';
import { AuditLogger } from './logging.js';

const ACTIVE = new Set(['queued', 'running']);
const PUBLIC_ERROR = { message: 'Failed to prepare digest' };

export class SubmissionConflictError extends Error {
  constructor() {
    super('submission_conflict');
    this.name = 'SubmissionConflictError';
    this.code = 'submission_conflict';
  }
}

function fingerprint(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function safeProgress(event) {
  if (!event || typeof event !== 'object') return null;
  const safe = {};
  for (const key of ['phase', 'sourceCount', 'candidateLinkCount', 'candidateCount']) {
    if (typeof event[key] === 'string' || Number.isSafeInteger(event[key])) safe[key] = event[key];
  }
  if (Array.isArray(event.sourceHosts)) safe.sourceHosts = event.sourceHosts.filter((value) => typeof value === 'string');
  return safe;
}

export function createDigestJobs({
  worker,
  clock = Date.now,
  ttlMs = 30 * 60_000,
  maxJobs = 100,
  onComplete = async () => null,
  loggerFactory = () => new AuditLogger()
}) {
  const jobs = new Map();
  const submissions = new Map();
  const activeFingerprints = new Map();
  const queue = [];
  let running = false;

  const remove = (job) => {
    jobs.delete(job.id);
    if (activeFingerprints.get(job.fingerprint) === job.id) activeFingerprints.delete(job.fingerprint);
    for (const submissionId of job.submissionIds) submissions.delete(submissionId);
  };

  const removeExpired = () => {
    const now = clock();
    for (const job of jobs.values()) {
      if (!ACTIVE.has(job.status) && now - job.finishedAt >= ttlMs) remove(job);
    }
  };

  const drain = async () => {
    if (running) return;
    const job = queue.shift();
    if (!job) return;
    running = true;
    job.status = 'running';
    try { await job.onStart?.(job.input); } catch { /* status persistence must not stop research */ }
    job.logger.info('digest.job.started', { jobId: job.id });
    try {
      job.result = await worker(job.input, (event) => { job.progress = safeProgress(event); }, job.logger);
      try { job.history = await (job.onComplete || onComplete)(job.input, job.result); }
      catch (error) {
        job.persistenceError = true;
        job.logger.error('digest.history.persist_failed', { jobId: job.id, errorName: error?.name || 'StorageError' });
      }
      job.status = 'complete';
      job.logger.info('digest.job.completed', { jobId: job.id });
    } catch (error) {
      job.status = 'error';
      job.error = PUBLIC_ERROR;
      try { await job.onFailure?.(job.input, error); } catch { /* preserve the original safe job failure */ }
      job.logger.error('digest.job.failed', { jobId: job.id, errorName: error?.name || 'UnknownError' });
    } finally {
      job.finishedAt = clock();
      if (activeFingerprints.get(job.fingerprint) === job.id) activeFingerprints.delete(job.fingerprint);
      running = false;
      queueMicrotask(drain);
    }
  };

  return {
    submit(rawInput, hooks = {}) {
      const { executionPassword: _password, submissionId, ...input } = rawInput;
      removeExpired();
      const submittedJob = jobs.get(submissions.get(submissionId));
      if (submittedJob) {
        if (submittedJob.fingerprint !== fingerprint(input)) throw new SubmissionConflictError();
        submittedJob.logger.info('digest.job.reused', { jobId: submittedJob.id });
        return { jobId: submittedJob.id, status: submittedJob.status, reused: true, ...(submittedJob.historyId ? { historyId: submittedJob.historyId } : {}) };
      }
      const key = fingerprint(input);
      const existing = activeFingerprints.get(key);
      if (existing) {
        const job = jobs.get(existing);
        submissions.set(submissionId, job.id);
        job.submissionIds.add(submissionId);
        job.logger.info('digest.job.reused', { jobId: job.id });
        return { jobId: job.id, status: job.status, reused: true, ...(job.historyId ? { historyId: job.historyId } : {}) };
      }
      if (jobs.size >= maxJobs) throw new Error('Digest service is busy');
      const id = `job_${randomBytes(24).toString('base64url')}`;
      const logger = loggerFactory();
      const job = { id, fingerprint: key, submissionIds: new Set([submissionId]), input, historyId: hooks.historyId || null, onStart: hooks.onStart, onComplete: hooks.onComplete, onFailure: hooks.onFailure, status: 'queued', progress: null, result: null, error: null, finishedAt: null, logger };
      jobs.set(id, job);
      submissions.set(submissionId, id);
      activeFingerprints.set(key, id);
      queue.push(job);
      logger.info('digest.job.submitted', { jobId: id });
      queueMicrotask(drain);
      return { jobId: id, status: job.status, reused: false, ...(job.historyId ? { historyId: job.historyId } : {}) };
    },

    status(jobId) {
      removeExpired();
      const job = jobs.get(jobId);
      if (!job) return null;
      const snapshot = { jobId: job.id, status: job.status };
      if (job.historyId) snapshot.historyId = job.historyId;
      if (job.progress) snapshot.progress = job.progress;
      if (job.status === 'complete') {
        snapshot.result = job.history ? { ...job.result, historyId: job.history.id, historyRevision: job.history.revision } : job.result;
        if (job.persistenceError) snapshot.persistenceError = true;
      }
      if (job.status === 'error') snapshot.error = job.error;
      return snapshot;
    }
  };
}
