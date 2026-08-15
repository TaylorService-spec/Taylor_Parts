// Local-date <-> epoch-ms helpers for <input type="date"> binding (PURE; no I/O). Extracted out of
// modules/sales/SalesWorkspace.jsx so it can be shared with modules/sales/NewOpportunityForm.jsx without
// those two modules importing each other (which would be circular once the form is rendered from the
// workspace). SalesWorkspace.jsx re-exports these two names unchanged, so its existing
// `import { isoDate, parseLocalDate } from "./SalesWorkspace.jsx"` call site (test/salesWorkspaceDate.test.jsx)
// keeps working.

// ISO date for <input type="date"> binding (yyyy-mm-dd); null-safe.
export const isoDate = (ms) => {
  if (typeof ms !== "number") return "";
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const parseLocalDate = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
};
