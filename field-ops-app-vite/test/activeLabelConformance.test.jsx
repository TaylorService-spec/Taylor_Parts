// "Active" vocabulary conformance gate.
//
// Owner ruling (feat/active-vocabulary, 2026-08-18): "Active" names four distinct concepts in this
// codebase (Employee active / Role assignment active / Capability active / Record active), plus a
// discovered fifth sense (Work Order "in progress") that is inconsistently scoped across screens.
// See docs/architecture/ADR-012-persona-authority-composition-and-scope.md section 2.2a for the
// full vocabulary and the "when is a bare Active label safe?" rule of thumb.
//
// This gate follows the SAME allowlist-burn-down pattern as compositionConformance.test.jsx's
// LEGACY_BADGE_ALLOWLIST:
//   - BARE_ACTIVE_ALLOWLIST is the closed set of sites where a bare, unqualified "Active" string is
//     safe TODAY because the surrounding page/section title already pins the record type (a generic
//     master-data registry -- Warehouse/Supplier/Equipment/Part/Truck/Employee/etc. -- where no
//     second "active" sense could be confused with it on the same screen).
//   - Any NEW bare "Active" site outside this allowlist fails the build -- a developer adding one
//     must either qualify the label (e.g. "Active Employees", "In Progress", "Enabled") or add the
//     site here with a one-line justification for why it is genuinely unambiguous.
//   - The allowlist may not contain stale entries (a file that no longer has a bare "Active" match
//     must be removed), so the corpus cannot silently grow via accumulated debris.
//
// Detection is intentionally narrow (quoted `"Active"`/`'Active'` string literals, and JSX text
// nodes reading exactly "Active" or "Active:"), and comment-only lines are skipped -- this is a
// user-facing-string gate, not a prose/identifier gate. It will not catch every possible phrasing,
// but it catches exactly the pattern the Owner ruling calls out: a column header, filter/tab/pill,
// or option label reading bare "Active" next to data where ambiguity is possible.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

// Snapshot taken when this gate was introduced (feat/active-vocabulary). Every entry here is a
// generic master-data / record-status registry (Employee, Warehouse, Supplier, Equipment, Part,
// Truck, EquipmentModel, PartAlias, SalesTerritory, MobileLocation, TransferOrder, Manufacturer)
// where the bare "Active" label always renders under a page/section title that already names the
// record type -- see ADR-012 section 2.2a's rule of thumb. This list may only ever SHRINK (a site
// qualified with a concept-naming label is removed) and must never grow without a documented reason.
const BARE_ACTIVE_ALLOWLIST = new Set([
  "domain/constants.js", // ACCOUNT_STATUS_LABEL -- Record active
  "domain/employeeVocabulary.js", // EMPLOYMENT_STATUS_LABEL -- Employee active (the canonical concept-1 site itself)
  "domain/equipmentStatus.js", // STATUS_LABEL -- Record active
  "domain/manufacturerVocabulary.js", // Record active
  "domain/partVocabulary.js", // Record active
  "domain/suppliersView.js", // Record active
  "domain/transfersView.js", // Record active (transfer-order in-flight grouping, page-scoped)
  "domain/truckManagement.js", // Record active
  "domain/warehousesView.js", // Record active (canonical concept-4 example, see its own doc comment)
  "metadata/definitions/employee.js", // Employee active saved view
  "metadata/definitions/equipment.js", // Record active
  "metadata/definitions/equipmentModel.js", // Record active
  "metadata/definitions/manufacturer.js", // Record active
  "metadata/definitions/mobileLocation.js", // Record active
  "metadata/definitions/partAlias.js", // Record active
  "metadata/definitions/salesTerritory.js", // Record active
  "metadata/definitions/supplier.js", // Record active
  "metadata/definitions/transferOrder.js", // Record active
  "metadata/definitions/truck.js", // Record active (trucks.status, distinct from trucks.active boolean -- see truck.js comments)
  "metadata/definitions/warehouse.js", // Record active
  "modules/equipment/EquipmentDetail.jsx", // Record active
  "modules/equipment/EquipmentEditModal.jsx", // Record active (form option)
  "modules/equipment/EquipmentRegister.jsx", // Record active
  "modules/equipment/equipmentStatusFilters.js", // Record active
  "domain/partVocabulary.js", // Record active -- the PART RECORD, as against superseded/discontinued;
  //                              the ONE Part label authority, read by both the metadata layer and the
  //                              write modal (the retired pilot map that duplicated it is gone)
  "modules/inventory/Warehouses.jsx", // Record active, page titled "Warehouses"
  "modules/purchasing/Suppliers.jsx", // Record active, page titled "Suppliers"
  "shared/supplier/SupplierPicker.jsx", // Record active, rendered alongside a Supplier name
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(SRC, p).split("\\").join("/");
const read = (relPath) => readFileSync(join(SRC, relPath), "utf8");

// Quoted string literal that is EXACTLY "Active" (or 'Active') -- e.g. `label: "Active"`,
// `<option>Active</option>`'s value prop, filter-chip labels. The same-quote backreference means
// "Active Employees" or "Inactive" do not match (no quote immediately follows "Active").
const QUOTED_ACTIVE = /(["'])Active\1/;
// JSX text node reading exactly "Active" or "Active:" -- e.g. `<th>Active</th>`, `Active: {count}`.
const JSX_TEXT_ACTIVE = />\s*Active\s*(?=[<:])/;

function bareActiveLines(text) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return false;
      return QUOTED_ACTIVE.test(line) || JSX_TEXT_ACTIVE.test(line);
    });
}

describe('"Active" vocabulary conformance — no new bare, unqualified "Active" labels', () => {
  const allFiles = walk(SRC).filter((p) => {
    const r = rel(p);
    return (
      r.startsWith("modules/") ||
      r.startsWith("shared/") ||
      r.startsWith("domain/") ||
      r.startsWith("metadata/")
    );
  });

  it("GATE 1 — no new bare \"Active\" label: every site outside the allowlist is clean", () => {
    const offenders = allFiles
      .filter((p) => bareActiveLines(readFileSync(p, "utf8")).length > 0)
      .map(rel)
      .filter((r) => !BARE_ACTIVE_ALLOWLIST.has(r));
    expect(
      offenders,
      `New bare "Active" label(s) found -- name the concept (Employee active / Role assignment active / ` +
        `Capability active / Record active / Work Order in-progress). See ADR-012 section 2.2a:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("GATE 2 — allowlist is not stale: every allowlisted file still has a bare \"Active\" site", () => {
    const stale = [...BARE_ACTIVE_ALLOWLIST].filter((r) => bareActiveLines(read(r)).length === 0);
    expect(
      stale,
      `Allowlist entry no longer has a bare "Active" label -- remove it so the list keeps shrinking:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("GATE 3 — allowlisted files actually exist under src/", () => {
    const missing = [...BARE_ACTIVE_ALLOWLIST].filter((r) => !allFiles.map(rel).includes(r));
    expect(missing, `Allowlist entry does not resolve to a real file:\n${missing.join("\n")}`).toEqual([]);
  });
});
