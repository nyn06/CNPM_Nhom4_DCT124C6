const jobs = new Map();
class Repository {
  enqueue(id, reconcile = false) {
    const current = jobs.get(id);
    if (reconcile && current && current.status !== 'done') return;
    jobs.set(id, { poiId: id, status: 'pending', attempts: 0,
      revision: (current?.revision || 0) + 1, nextAttemptAt: 0, leaseUntil: null, lastErrorCode: null });
  }

  claim() {
    const now = Date.now();
    const job = [...jobs.values()].find((entry) => (['pending', 'failed'].includes(entry.status) && entry.nextAttemptAt <= now)
      || (entry.status === 'processing' && entry.leaseUntil <= now));
    if (!job) return null;
    job.status = 'processing';
    job.attempts += 1;
    job.leaseUntil = now + 300000;
    return { ...job };
  }

  complete(job) {
    const current = jobs.get(job.poiId);
    if (current?.revision === job.revision && current.status === 'processing') {
      current.status = 'done';
      current.leaseUntil = null;
    }
  }

  fail(job, code) {
    const current = jobs.get(job.poiId);
    if (current?.revision === job.revision && current.status === 'processing') {
      current.status = current.attempts >= 3 ? 'failed' : 'pending';
      current.nextAttemptAt = Date.now() + [0, 10000, 60000, 600000, 1800000][Math.min(current.attempts, 4)];
      if (current.attempts > 4) current.nextAttemptAt = Date.now() + 3600000;
      current.leaseUntil = null;
      current.lastErrorCode = code;
    }
  }

  get(id) { return jobs.get(id); }
  clear() { jobs.clear(); }
}
module.exports = new Repository();
