const secretValues = () => Object.entries(process.env)
  .filter(([name, value]) => /PASSWORD|SECRET|TOKEN|API_KEY/i.test(name) && value?.length >= 4)
  .map(([, value]) => value);

function safeMessage(value) {
  if (typeof value !== 'string') return 'unavailable';
  let message = value.split(/\r?\n/, 1)[0].slice(0, 1000);
  if (/\b(?:server|data source)\s*=/.test(message.toLowerCase())
    && /\b(?:database|initial catalog)\s*=/.test(message.toLowerCase())) {
    return '[redacted connection details]';
  }
  for (const secret of secretValues()) message = message.split(secret).join('[redacted]');
  return message.replace(/\b(password|pwd|user id|uid|api[_ -]?key|token)\s*[:=]\s*[^;\s]+/gi, '$1=[redacted]');
}

function describe(error) {
  if (!error || typeof error !== 'object') return 'error=unavailable';
  const original = error.originalError?.info || error.originalError || {};
  const number = error.number ?? original.number;
  const line = error.lineNumber ?? original.lineNumber;
  const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(error.code)
    ? error.code : 'unknown';
  return `code=${code} number=${Number.isInteger(number) ? number : 'unknown'} `
    + `line=${Number.isInteger(line) ? line : 'unknown'} message=${safeMessage(error.message || original.message)}`;
}

function formatMigrationError(error) {
  const migration = /^\d+_[a-z0-9_-]+\.sql$/.test(error?.migrationName || '')
    ? error.migrationName : 'unknown';
  const stage = /^[a-z_]{1,40}$/.test(error?.migrationStage || '')
    ? error.migrationStage : 'unknown';
  const lines = [`Migration failed: migration=${migration} stage=${stage}`, describe(error)];
  if (error?.originalError?.message && error.originalError.message !== error.message) {
    lines.push(`original: ${describe(error.originalError)}`);
  }
  for (const preceding of (Array.isArray(error?.precedingErrors) ? error.precedingErrors : []).slice(0, 5)) {
    lines.push(`preceding: ${describe(preceding)}`);
  }
  if (error?.rollbackError) lines.push(`rollback: ${describe(error.rollbackError)}`);
  return lines.join('\n');
}

module.exports = { formatMigrationError };
