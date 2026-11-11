const { formatMigrationError } = require('../database/migration-error');

test('reports SQL migration, phase, number, line, original and preceding errors without secrets', () => {
  const previous = process.env.DB_PASSWORD;
  process.env.DB_PASSWORD = 'test-secret-value';
  try {
    const cause = Object.assign(new Error('Cannot alter column: test-secret-value'), {
      code: 'EREQUEST', number: 5074, lineNumber: 9,
      originalError: Object.assign(new Error('Original test-secret-value'), {
        info: { number: 5074, lineNumber: 9 },
      }),
      precedingErrors: [Object.assign(new Error('Earlier dependency failure'), {
        code: 'EREQUEST', number: 4922, lineNumber: 9,
      })],
      migrationName: '007_voucher_purchases.sql', migrationStage: 'apply_batch',
    });
    const output = formatMigrationError(cause);
    expect(output).toContain('migration=007_voucher_purchases.sql stage=apply_batch');
    expect(output).toContain('number=5074 line=9');
    expect(output).toContain('original:');
    expect(output).toContain('preceding: code=EREQUEST number=4922');
    expect(output).not.toContain('test-secret-value');
  } finally {
    if (previous === undefined) delete process.env.DB_PASSWORD;
    else process.env.DB_PASSWORD = previous;
  }
});

test('redacts connection strings and ignores untrusted context fields', () => {
  const output = formatMigrationError({ message: 'Server=host;Database=db;User ID=sa;Password=secret',
    migrationName: '../../secret.sql', migrationStage: 'apply batch' });
  expect(output).toContain('migration=unknown stage=unknown');
  expect(output).toContain('[redacted connection details]');
  expect(output).not.toContain('Password=secret');
});
