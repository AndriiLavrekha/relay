// Detects workers that return abbreviated files ("// ... rest unchanged") instead of complete content.
const COMMENT_START = /^\s*(?:\/\/|#|\/\*|\*|<!--|--|;|'|%|rem\b)/i;
// Phrases that stand alone as placeholders, plus "existing/previous/other ..." only next to an ellipsis
// ("// ... existing code ..."), because "// keep existing logic" is an ordinary comment.
const PHRASE = /\b(?:rest of (?:the )?(?:file|code|class|module|implementation|function|methods?)|(?:remains?|stays?|kept|left) unchanged|unchanged (?:code|parts?|sections?|methods|functions)|omitted for brevity|same as (?:before|original|above)|(?:implementation|code) omitted)\b|(?:\.{3}|…)\s*(?:the\s+)?(?:rest|remaining|existing|unchanged|other|previous)\b|\b(?:existing|remaining|previous|other) (?:code|implementation|methods|functions|logic)\s*(?:\.{3}|…)/i;
const BARE_ELLIPSIS_COMMENT = /^\s*(?:\/\/|#|\/\*|<!--|--)\s*(?:\.{3}|…)\s*(?:\*\/|-->)?\s*$/;

const MAX_MARKERS = 5;
const SHRINK_MIN_BASELINE_LINES = 40;
const SHRINK_RATIO = 0.5;

function lineCount(text) {
  return text === '' ? 0 : text.split('\n').length;
}

export function findElisionMarkers(content, baselineContent = '') {
  const baselineLines = new Set(baselineContent.split(/\r?\n/).map((line) => line.trim()));
  const markers = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length && markers.length < MAX_MARKERS; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || baselineLines.has(trimmed)) continue;
    const marker = BARE_ELLIPSIS_COMMENT.test(line) || (COMMENT_START.test(line) && PHRASE.test(line));
    if (marker) markers.push({ line: i + 1, text: trimmed.slice(0, 160) });
  }
  return markers;
}

export function detectElision({ content, baselineContent = null }) {
  const markers = findElisionMarkers(content, baselineContent ?? '');
  let shrink = null;
  if (baselineContent !== null) {
    const before = lineCount(baselineContent);
    const after = lineCount(content);
    if (before >= SHRINK_MIN_BASELINE_LINES && after < before * SHRINK_RATIO) shrink = { baselineLines: before, resultLines: after };
  }
  return { suspect: markers.length > 0 || shrink !== null, markers, shrink };
}

// 'crlf' only when every newline is CRLF; mixed files return null and are left untouched.
export function eolStyle(text) {
  const lf = (text.match(/\n/g) ?? []).length;
  if (lf === 0) return null;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  if (crlf === 0) return 'lf';
  return crlf === lf ? 'crlf' : null;
}

export function normalizeEol(content, style) {
  if (style === 'lf') return content.replace(/\r\n/g, '\n');
  if (style === 'crlf') return content.replace(/\r?\n/g, '\r\n');
  return content;
}
