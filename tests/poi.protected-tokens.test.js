const { restore } = require('../src/services/poi-protected-tokens');

const token = 'ABCFOOD0ABC';
const entries = [{ token, value: 'banh canh' }];

test('restores an exact token once without leaking marker fragments', () => {
  expect(restore(`Serves ${token} with broth.`, entries))
    .toEqual({ text: 'Serves banh canh with broth.' });
});

test.each([
  ['missing', 'Serves soup.', 'protected_term_missing'],
  ['repeated', `${token} and ${token}`, 'protected_term_repeated'],
  ['unknown', `${token} and ABCFOOD9ABC`, 'protected_term_corrupted'],
  ['foreign', `${token} and OTHERTERM9OTHER`, 'protected_term_corrupted'],
  ['fragment', `${token} and ABC`, 'protected_term_corrupted'],
  ['altered', 'ABCFOOD0AB and broth', 'protected_term_missing'],
])('rejects a %s token', (_case, output, reason) => {
  expect(restore(output, entries)).toEqual({ reason });
});

test('detects the stray fragment observed in a Japanese POI translation', () => {
  expect(restore('ZXQFOOD0ZXQ を提供する ZXQ',
    [{ token: 'ZXQFOOD0ZXQ', value: 'pho' }]))
    .toEqual({ reason: 'protected_term_corrupted' });
});
