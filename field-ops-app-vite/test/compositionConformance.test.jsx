// Composition conformance gates (site-wide card/composition standardization).
//
// These are the ENFORCEMENT half of the standardization program: they let the design system spread
// wave-by-wave WITHOUT backsliding. Each gate is a burn-down — a surface migrated to the composition
// primitives (WorkspaceShell/ContextBand/ActionRail/StatusPill) is removed from the legacy allowlist and
// added to the conformant set; the gates then hold it there. New surfaces cannot introduce the retired
// patterns at all.
//
// The four gates:
//   1. NO NEW STATUS BADGE — the retired `fo-badge` family may appear ONLY in files still on the
//      LEGACY_BADGE_ALLOWLIST. Any other file using it (a new surface, or a migrated surface that
//      regressed) fails. Status must route through the shared StatusPill + a domain tone map.
//   2. CONFORMANT WORKSPACES ADOPT THE SHELL — every surface declared conformant imports WorkspaceShell.
//   3. CONFORMANT SURFACES ARE STATUS-STANDARDIZED — no conformant surface contains `fo-badge`.
//   4. BURN-DOWN IS MONOTONE — a file cannot be both allowlisted and conformant, and the allowlist may
//      not contain stale entries (a file that no longer uses `fo-badge` MUST be removed). This is what
//      forces the corpus to shrink: you cannot migrate a file and silently leave it on the allowlist.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

// Files still carrying the retired fo-badge treatment. This list may only ever SHRINK — each wave removes
// the files it migrates. It must never grow. (Snapshot taken at Wave 1; Truck Inventory already migrated
// out. Wave 2 removed the accounts cluster. Wave 3 removed the equipment cluster. Wave 4 removed the
// inventory + inventoryRole clusters. Wave 5 removed the remaining 10 files -- allowlist is now empty.)
const LEGACY_BADGE_ALLOWLIST = new Set([]);

// Surfaces that have completed migration to the composition primitives. Grows each wave.
const CONFORMANT_WORKSPACES = [
  "modules/sales/SalesWorkspace.jsx",
  "modules/service/CoordinatedVisitsWorkspace.jsx",
  "modules/mobile/CoordinatedMissionView.jsx",
  "modules/inventory/TruckInventory.jsx", // Wave 1
  "modules/accounts/AccountsList.jsx", // Wave 2
  "modules/accounts/AccountDetail.jsx", // Wave 2
  "modules/equipment/EquipmentDetail.jsx", // Wave 3
  "modules/equipment/EquipmentRegister.jsx", // Wave 3
  "modules/inventory/Inventory.jsx", // Wave 4 (unrouted/dead code -- see final report)
  "modules/inventory/PartDetail.jsx", // Wave 4
  "modules/inventory/PartsList.jsx", // Wave 4
  "modules/inventoryRole/PartsAssociateHome.jsx", // Wave 4
  "modules/inventoryRole/PartsManagerHome.jsx", // Wave 4
  "modules/inventoryRole/WarehouseManagerHome.jsx", // Wave 4
  "modules/jobs/Jobs.jsx", // Wave 5
  "modules/technicians/Technicians.jsx", // Wave 5
  "modules/technicianDashboard/TechnicianDashboard.jsx", // Wave 5
];
// Non-workspace conformant surfaces (peer-object cards etc.) — status-standardized, but not shell hosts.
const CONFORMANT_SURFACES = [
  ...CONFORMANT_WORKSPACES,
  "modules/inventory/TruckFleetCard.jsx",
  "modules/accounts/FinancialSummarySection.jsx", // Wave 2
  "modules/accounts/ServiceActivitySection.jsx", // Wave 2
  "modules/equipment/InventoryControlSection.jsx", // Wave 3
  "modules/inventory/truckManagement/OutcomeBanner.jsx", // Wave 4
  "modules/inventory/UsedInEquipmentSection.jsx", // Wave 4
  "modules/dispatcherBoard/TechnicianBoard.jsx", // Wave 5
  "modules/operations/panels/InventoryHealthPanel.jsx", // Wave 5
  "modules/operations/panels/ProcurementPanel.jsx", // Wave 5
  "modules/operations/panels/WarehousePanel.jsx", // Wave 5
  "modules/reporting/ReportBuilder.jsx", // Wave 5
  "modules/workOrders/CustomerPicker.jsx", // Wave 5
  "shared/ui/NotificationPanel.jsx", // Wave 5
];

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
const usesBadge = (text) => /fo-badge/.test(text);

describe("composition conformance — site-wide standardization gates", () => {
  const allFiles = walk(SRC).filter((p) => {
    const r = rel(p);
    return r.startsWith("modules/") || r.startsWith("shared/");
  });

  it("GATE 1 — no new fo-badge: the retired status treatment appears only on the legacy allowlist", () => {
    const offenders = allFiles
      .filter((p) => usesBadge(readFileSync(p, "utf8")))
      .map(rel)
      .filter((r) => !LEGACY_BADGE_ALLOWLIST.has(r));
    expect(offenders, `New/regressed fo-badge usage — migrate to StatusPill:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("GATE 2 — conformant workspaces adopt WorkspaceShell", () => {
    const missing = CONFORMANT_WORKSPACES.filter((r) => !/WorkspaceShell/.test(read(r)));
    expect(missing, `Conformant workspace missing WorkspaceShell:\n${missing.join("\n")}`).toEqual([]);
  });

  it("GATE 3 — conformant surfaces are status-standardized (no fo-badge)", () => {
    const dirty = CONFORMANT_SURFACES.filter((r) => usesBadge(read(r)));
    expect(dirty, `Conformant surface still uses fo-badge:\n${dirty.join("\n")}`).toEqual([]);
  });

  it("GATE 4 — burn-down is monotone: no file is both allowlisted and conformant, and no allowlist entry is stale", () => {
    const both = CONFORMANT_SURFACES.filter((r) => LEGACY_BADGE_ALLOWLIST.has(r));
    expect(both, `File is both allowlisted and conformant (remove from allowlist):\n${both.join("\n")}`).toEqual([]);

    const stale = [...LEGACY_BADGE_ALLOWLIST].filter((r) => !usesBadge(read(r)));
    expect(stale, `Allowlist entry no longer uses fo-badge — remove it so the corpus keeps shrinking:\n${stale.join("\n")}`).toEqual([]);
  });
});
