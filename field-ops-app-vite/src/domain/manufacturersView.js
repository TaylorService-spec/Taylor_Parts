// Manufacturer -- PURE read view helpers (no Firebase/I/O; Node-importable, unit-tested). Shapes raw
// `manufacturers` docs into a deterministic list view. Client MIRROR of the governed status vocabulary
// (functions/src/partMaster/types.ts MANUFACTURER_STATUSES) -- not a second authority. Malformed records
// are surfaced as a count, never rendered as raw objects.
export const MANUFACTURER_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

function str(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Build { manufacturers, invalid } from raw {id,data} docs. A valid record needs a non-blank id that
// equals its doc id, a non-blank name, and a governed status. `version` defaults to 0 when absent.
export function toManufacturerListView(docs) {
  const manufacturers = [];
  const invalid = [];
  for (const { id, data } of Array.isArray(docs) ? docs : []) {
    const d = data && typeof data === "object" ? data : {};
    const manufacturerId = str(d.manufacturerId);
    const name = str(d.name);
    const status = MANUFACTURER_STATUSES.includes(d.status) ? d.status : null;
    if (manufacturerId === null || manufacturerId !== id || name === null || status === null) {
      invalid.push(id);
      continue;
    }
    manufacturers.push({ manufacturerId, name, status, version: Number.isInteger(d.version) ? d.version : 0 });
  }
  manufacturers.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.manufacturerId.localeCompare(b.manufacturerId)));
  return { manufacturers, invalid };
}
