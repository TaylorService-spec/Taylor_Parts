// Customer/Account Business Model -- Customer PR 3, Service Activity.
// PURE render-decision helpers with NO Firebase import, so they are
// directly unit-testable in Node (this repo has no React test renderer).
// ServiceActivitySection renders each element strictly from the view these
// return, so the four failure-independence guarantees are provable without
// a browser: each element's view is a function of ONLY its own state, so
// one element's error can never change what another renders.

// One count cell (Completed or Open), from its own { value, loading, error }.
export function countView(state) {
  if (state.loading) return { kind: "loading" };
  if (state.error) return { kind: "error" };
  return { kind: "value", value: state.value };
}

// The Account Activity timeline, from its own state. `empty` is a genuine
// zero (query returned no Work Orders), distinct from `error`.
export function timelineView(state) {
  if (state.loading) return { kind: "loading" };
  if (state.error) return { kind: "error" };
  if (!state.items || state.items.length === 0) return { kind: "empty" };
  return { kind: "list" };
}
