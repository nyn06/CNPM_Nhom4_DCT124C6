const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function restore(text, entries) {
  const input = String(text || '');
  const markers = entries.map(({ token }) => {
    const parts = token.match(/^([A-Z]{3,})\d+([A-Z]{3,})$/u);
    if (!parts) throw new TypeError('Invalid protected token format.');
    return new RegExp(`${escape(parts[1])}|${escape(parts[2])}`, 'iu');
  });
  for (const { token } of entries) {
    const count = input.split(token).length - 1;
    if (count !== 1) return { reason: count ? 'protected_term_repeated' : 'protected_term_missing' };
  }
  let stripped = input;
  for (const { token } of entries) stripped = stripped.replace(token, '');
  if (markers.some((pattern) => pattern.test(stripped))
    || /[A-Z]{3,}[A-Z0-9]*\d+[A-Z]{3,}/u.test(stripped)
    || /__[A-Z][A-Z0-9_]*__/u.test(stripped))
    return { reason: 'protected_term_corrupted' };
  let output = input;
  for (const { token, value } of entries) output = output.replace(token, value);
  if (markers.some((pattern) => pattern.test(output)))
    return { reason: 'placeholder_leaked' };
  return { text: output };
}

module.exports = { restore };
