export function textOf(value, fallback) {
  const text = value === null || value === undefined ? '' : String(value)
  return text.length > 0 ? text : fallback
}

export function classToken(value) {
  return textOf(value, 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
