
const repository = require('../repositories/voucher-management.repository');

const invalid = () => Object.assign(
  new Error('Bộ lọc hoặc trang không hợp lệ.'),
  { statusCode: 400, code: 'INVALID_FILTER' }
);

function options(query, kind) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const search = query.search === undefined ? '' : query.search;
  const status = query.status === undefined ? 'all' : query.status;

  const allowed = kind === 'vouchers'
    ? ['all', 'unused', 'active', 'expired']
    : ['all', 'active', 'expired', 'revoked'];

  if (!Number.isSafeInteger(page) || page < 1 || page > 100000
    || typeof search !== 'string'
    || search.length > 36
    || (search && !/^[a-f0-9-]+$/i.test(search))
    || typeof status !== 'string'
    || !allowed.includes(status)) {
    throw invalid();
  }

  const result = {
    page,
    search: search.toLowerCase(),
    status,
    limit: 10,
    now: new Date().toISOString()
  };

  if (kind === 'vouchers') {
    const duration = query.duration === undefined
      ? 'all' : query.duration;

    const createdDate = query.createdDate === undefined
      ? '' : query.createdDate;

    if (!['all', '15', '60', '120'].includes(duration)
      || typeof createdDate !== 'string'
      || (createdDate && !/^\d{4}-\d{2}-\d{2}$/.test(createdDate))) {
      throw invalid();
    }

    if (createdDate) {
      const parsed = new Date(`${createdDate}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== createdDate) {
        throw invalid();
      }
    }

    result.duration = duration === 'all'
      ? null : Number(duration);

    result.createdDate = createdDate;
  }

  return result;
}

module.exports = {
  vouchers: (query) => repository.vouchers(options(query, 'vouchers')),
  activations: (query) => repository.activations(options(query, 'activations'))
};
