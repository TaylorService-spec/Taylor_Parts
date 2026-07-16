// Issue #325 / ADR-007 W1 -- PURE helpers that turn a run outcome's projected rows/aggregates
// into table columns + safe cell text. No firebase, no JSX -- node-testable, so the load-bearing
// FIELD-OMISSION behavior is provable in a unit test: a field the runner may not read is ABSENT
// from every row object (the trusted Function projects it out), so it never becomes a column here.
import { getReportField } from "./reportCatalog.js";

// Columns for the raw-rows table: the SELECTED fields (in the author's order) that actually
// survived projection, then any unexpected extra keys (defensive). Labels from the catalog.
export function rowColumns(selectedFieldIds, rows) {
  const present = new Set();
  for (const r of rows ?? []) for (const k of Object.keys(r)) present.add(k);
  const selected = Array.isArray(selectedFieldIds) ? selectedFieldIds : [];
  const ordered = selected.filter((fid) => present.has(fid));
  const extra = [...present].filter((k) => !selected.includes(k));
  return [...ordered, ...extra].map((key) => ({ key, label: getReportField(key)?.label ?? key }));
}

// Columns for the grouped/aggregated table: whatever keys the aggregate rows carry -- group-field
// ids (labelled from the catalog) plus aggregate result keys (countRows -> "Row count").
export function aggregateColumns(rows) {
  const keys = new Set();
  for (const r of rows ?? []) for (const k of Object.keys(r)) keys.add(k);
  return [...keys].map((key) => ({ key, label: aggregateColumnLabel(key) }));
}

export function aggregateColumnLabel(key) {
  if (key === "countRows") return "Row count";
  return getReportField(key)?.label ?? key;
}

// Render a projected cell value as safe text. Never renders an object/array structurally (avoids
// surfacing a nested shape); nullish reads as an em dash.
export function formatCell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? "" : String(v))).filter(Boolean).join(", ");
  if (typeof value === "object") return "";
  return String(value);
}
