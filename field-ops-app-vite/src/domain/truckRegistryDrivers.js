// EI-P1d-2-2b -- pure helper: from the raw `trucks` read, collect the DISTINCT set of
// assignedDriverEmployeeId values that actually need an Employee display-name lookup.
//
// This is what makes the driver-name resolution NO N+1: the read hook resolves names for
// this bounded, de-duplicated id set in one batched pass (documentId `in` chunks), NOT once
// per truck row. Pure and node-testable: no firebase, no reads, never throws on malformed
// input.
//
// A truck doc is the `{ docId, data }` pair shape the registry-source bridge consumes. Only a
// non-empty string assignedDriverEmployeeId counts; null/absent/blank/non-string (an
// unassigned or malformed truck) contributes no id. Order is deterministic (first-seen).
export function collectDriverEmployeeIds(truckDocs) {
  const seen = new Set();
  const ids = [];
  if (!Array.isArray(truckDocs)) return ids;
  for (const pair of truckDocs) {
    const data = pair && typeof pair === "object" ? pair.data : undefined;
    const id = data && typeof data === "object" ? data.assignedDriverEmployeeId : undefined;
    if (typeof id === "string" && id.trim() !== "" && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
