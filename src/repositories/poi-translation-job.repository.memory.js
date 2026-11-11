const jobs = new Map();
class Repository {
  findByPoiIds(ids) {
    return ids.map((id) => jobs.get(id)).filter(Boolean).map((job) => ({ ...job }));
  }

  enqueue(id, reconcile = false) {
    const current = jobs.get(id);
    if (reconcile && current && current.status !== 'done') return;
    jobs.set(id, { poiId: id, status: 'pending', attempts: 0,
      revision: (current?.revision || 0) + 1, nextAttemptAt: 0, leaseUntil: null, lastErrorCode: null });
  }

  claim() {
    const now = Date.now();
    const job = [...jobs.values()].find((entry) => (entry.status === 'pending' && entry.nextAttemptAt <= now)
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
      current.status = current.attempts >= 3
        || ['UNTRUSTED_TRANSLATION', 'UNVERIFIED_TRANSLATION', 'PROVIDER_AUTH'].includes(code)
        ? 'failed' : 'pending';
      current.nextAttemptAt = Date.now() + (code === 'PROVIDER_RATE_LIMIT'
        ? current.attempts === 1 ? 60000 : 600000 : current.attempts === 1 ? 10000 : 60000);
      current.leaseUntil = null;
      current.lastErrorCode = code;
    }
  }

  get(id) { return jobs.get(id); }
  clear() { jobs.clear(); }
}
module.exports = new Repository();
