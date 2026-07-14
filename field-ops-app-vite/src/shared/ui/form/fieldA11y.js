// Issue #214 PR-1 -- pure a11y-wiring helpers shared by the form primitives.
// No JSX and no React import, so the id/aria conventions are node-importable
// and unit-tested directly (test/formPrimitives.test.mjs). Field.jsx and its
// callers both use these so a control and its hint/error stay linked by the
// SAME derived ids.

export function hintId(id) {
  return id ? `${id}-hint` : undefined;
}

export function errorId(id) {
  return id ? `${id}-error` : undefined;
}

// aria-describedby string linking a control to whichever of its hint/error is
// currently rendered, in reading order (hint before error). Returns undefined
// when there is nothing to reference (so the attribute is omitted, not empty).
export function describedBy(id, { hasHint = false, hasError = false } = {}) {
  if (!id) return undefined;
  const ids = [];
  if (hasHint) ids.push(hintId(id));
  if (hasError) ids.push(errorId(id));
  return ids.length ? ids.join(" ") : undefined;
}

// The required indicator is conveyed as TEXT (never color alone), appended to
// the visible label.
export function requiredLabelSuffix(required) {
  return required ? " (required)" : "";
}
