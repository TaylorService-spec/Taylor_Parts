// Composition conformance gates (site-wide card/composition standardization).
//
// These are the ENFORCEMENT half of the standardization program: they let the design system spread
// wave-by-wave WITHOUT backsliding. Each gate is a burn-down — a surface migrated to the composition
// primitives (WorkspaceShell/ContextBand/ActionRail/StatusPill) is removed from the legacy allowlist and
// added to the conformant set; the gates then hold it there. New surfaces cannot introduce the retired
// patterns at all.
//
// The gates:
//   1. NO NEW STATUS BADGE — the retired `fo-badge` family may appear ONLY in files still on the
//      LEGACY_BADGE_ALLOWLIST. Any other file using it (a new surface, or a migrated surface that
//      regressed) fails. Status must route through the shared StatusPill + a domain tone map.
//   2. CONFORMANT WORKSPACES ADOPT THE SHELL — every surface declared conformant imports WorkspaceShell.
//   2b. NORTH STAR RECORD PAGES REPLACE THE SHELL — a record page migrated to the North Star grammar
//      composes `ns-page` + `RecordIdentity` and must NOT also host WorkspaceShell (running both
//      doubles the chrome and gives the page two competing h1 claims). This is a REPLACEMENT
//      obligation, not an exemption: 2b is stricter than 2, and 3 still applies through
//      CONFORMANT_SURFACES.
//   2b². MEMBERSHIP IS DERIVED — any surface that composes the North Star grammar must be declared,
//      so the list in 2b cannot be quietly emptied. A mutation proof found that hole: deleting an
//      entry made the gate check fewer files and nothing failed.
//   2c. NO PAGE ON BOTH SHELL LISTS — otherwise 2 and 2b demand opposite things of the same file and
//      whichever runs first decides.
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
  // EquipmentDetail.jsx LEFT this list for NORTH_STAR_RECORD_PAGES (family 8) when it stopped
  // hosting WorkspaceShell. The move is what GATE 2b² exists to force: a page migrates by moving
  // between lists, never by quietly appearing on neither.
  //
  // EquipmentRegister.jsx LEFT it too, and for a different reason worth stating: it is not a page at
  // all any more. It was a standalone route when Wave 3 declared it here; site-work #10 mounted it
  // as the Add Equipment TAB of EquipmentWorkspace, and it kept rendering its own
  // `WorkspaceShell title="Equipment"` inside a page that already had that title. Selecting the tab
  // produced two visible Equipment page identities. The shell is gone, so the shell obligation goes
  // with it — it is now declared in CONFORMANT_SURFACES as nested content, which keeps the fo-badge
  // rule and drops the one it can no longer honestly satisfy. No exception was added to GATE 2.
  "modules/inventory/Inventory.jsx", // Wave 4 (unrouted/dead code -- see final report)
  "modules/inventory/PartsList.jsx", // Wave 4
  "modules/inventoryRole/PartsAssociateHome.jsx", // Wave 4
  "modules/inventoryRole/PartsManagerHome.jsx", // Wave 4
  "modules/inventoryRole/WarehouseManagerHome.jsx", // Wave 4
  "modules/technicians/Technicians.jsx", // Wave 5
  "modules/technicianDashboard/TechnicianDashboard.jsx", // Wave 5
];
// Non-workspace conformant surfaces (peer-object cards etc.) — status-standardized, but not shell hosts.
const CONFORMANT_SURFACES = [
  ...CONFORMANT_WORKSPACES,
  // The North Star record pages are status-standardized like any other conformant surface; only
  // their SHELL obligation differs (see NORTH_STAR_RECORD_PAGES).
  "modules/workOrders/WorkOrderDetailPage.jsx",
  "modules/sales/SalesOrderDetail.jsx",
  "modules/accounts/AccountDetail.jsx",
  "modules/sales/OpportunityDetail.jsx",
  "modules/inventory/TruckFleetCard.jsx",
  "modules/accounts/FinancialSummarySection.jsx", // Wave 2
  "modules/accounts/ServiceActivitySection.jsx", // Wave 2
  "modules/equipment/InventoryControlSection.jsx", // Wave 3
  // MOVED here from CONFORMANT_WORKSPACES (Wave 3) by the Add-tab composition fix: nested tab
  // content of EquipmentWorkspace, which owns the page identity. Status-standardized like any other
  // conformant surface; it hosts no shell because it is not a page.
  "modules/equipment/EquipmentRegister.jsx",
  "modules/inventory/truckManagement/OutcomeBanner.jsx", // Wave 4
  "modules/inventory/UsedInEquipmentSection.jsx", // Wave 4
  // TechnicianBoard.jsx was deleted by the Dispatch North Star P1 composition (Wave 5 entry retired).
  "modules/operations/panels/InventoryHealthPanel.jsx", // Wave 5
  "modules/operations/panels/ProcurementPanel.jsx", // Wave 5
  "modules/operations/panels/WarehousePanel.jsx", // Wave 5
  "modules/reporting/ReportBuilder.jsx", // Wave 5
  "modules/workOrders/CustomerPicker.jsx", // Wave 5
  "shared/ui/NotificationPanel.jsx", // Wave 5
  // The North Star COLLECTION pages, on the same terms as the record pages above: only their SHELL
  // obligation differs (see NORTH_STAR_COLLECTION_PAGES). Listed literally rather than spread,
  // because GATE 2c compares the three membership arrays and a spread would make every collection
  // page look like a conformant workspace to it.
  "modules/sales/OpportunityList.jsx",
  "modules/workOrders/WorkOrdersList.jsx",
  "modules/accounts/AccountsList.jsx",
  "modules/sales/SalesOrdersList.jsx",
  "modules/inventory/PartMasterList.jsx",
  "modules/equipment/EquipmentWorkspace.jsx",
  "modules/purchasing/Suppliers.jsx",
  "modules/inventory/Manufacturers.jsx",
  // TRANCHE 2 — organization / location families.
  "modules/administration/EmployeesList.jsx",
  "modules/inventory/Warehouses.jsx",
  "modules/inventory/TruckInventory.jsx",  // moved from CONFORMANT_WORKSPACES (Wave 1)
  // TRANCHE 3 — operational movement families.
  "modules/purchasing/PurchaseOrders.jsx",
  "modules/inventory/Transfers.jsx",
  // OWNER VISUAL CORRECTION 2026-08-27 — Job Assignments was BLOCKED on a PRODUCT question and
  // therefore received no presentation work, which is why it looked nothing like Opportunity. The
  // product question governs whether the surface should EXIST, not what it looks like meanwhile.
  // Moved from CONFORMANT_WORKSPACES (Wave 5).
  "modules/jobs/Jobs.jsx",
];

// ════════════════════ NORTH STAR RECORD PAGES ════════════════════
//
// A record page migrated to the North Star grammar does NOT host WorkspaceShell. It composes
// `ns-page` + `RecordIdentity` instead, and the two are mutually exclusive on purpose: run
// together they double the page chrome and BOTH claim the `h1` (ND-4, already open).
//
// This list exists because families 1 and 2 shipped into a hole. WorkOrderDetailPage.jsx and
// SalesOrderDetail.jsx are on no list here at all -- they were never added to CONFORMANT_WORKSPACES
// (which would have demanded the shell they deliberately dropped), so from 2026-08-25 until now
// they satisfied NO composition obligation whatsoever. AccountDetail.jsx was on the Wave 2
// conformant list, and migrating it is what surfaced the conflict: the gate demanded a shell the
// grammar replaces.
//
// The obligation is REPLACED, not waived. Membership here is a stricter contract than
// CONFORMANT_WORKSPACES, not an exemption from it: these files must use the North Star page
// primitives, must NOT import WorkspaceShell, and remain bound by the fo-badge rule through
// CONFORMANT_SURFACES below.
const NORTH_STAR_RECORD_PAGES = [
  "modules/workOrders/WorkOrderDetailPage.jsx", // family 1
  "modules/sales/SalesOrderDetail.jsx",         // family 2
  "modules/accounts/AccountDetail.jsx",         // family 3 (formerly Wave 2 conformant)
  "modules/sales/OpportunityDetail.jsx",        // family 4 (a NEW page, not a recomposition)
  "modules/sales/SalesAgreementDetail.jsx",     // family 5 (a NEW routed record page)
  // family 6 -- a RECOMPOSITION, not a new page: it left CONFORMANT_WORKSPACES above when it
  // stopped hosting WorkspaceShell. Moving it required declaring it here in the same commit,
  // which is exactly what GATE 2b2 exists to force and what it caught when this migration
  // first ran.
  "modules/inventory/PartDetail.jsx",           // family 7 (Parts record)
  // family 8 -- a RECOMPOSITION like family 7's: it left CONFORMANT_WORKSPACES above in the same
  // commit that brought it here.
  "modules/equipment/EquipmentDetail.jsx",      // family 8 (Equipment record)
];

// ════════════════════ NORTH STAR COLLECTION PAGES ════════════════════
//
// GOVERNANCE: docs/north-star/lists/ (Lists P2), reconciliation §H.
//
// THE HOLE THIS CLOSES, AND IT IS THE SAME HOLE TWICE. The comment above records that families 1
// and 2 shipped onto no list at all and satisfied no composition obligation for weeks. The Lists P2
// reconciliation found that the collection half of the programme had shipped into the identical
// hole and nobody had noticed, because the fix last time added a list for RECORD pages only:
//
//   * OpportunityList.jsx (family 4b, the P1v4 collection) and WorkOrdersList.jsx both compose
//     WorkspaceIdentity — the ratified collection header — and appear on NO list here.
//   * NORTH_STAR_RECORD_PAGES cannot absorb them: it demands RecordIdentity, which is the RECORD's
//     identity primitive. A collection does not have one and must not grow one.
//   * AccountsList.jsx is on CONFORMANT_WORKSPACES. Migrating it to the collection grammar means
//     dropping WorkspaceShell, which fails GATE 2 — with nowhere to move it to.
//
// So a collection gets its own contract, mirroring the record one exactly: compose the collection
// grammar, do NOT also host WorkspaceShell (same doubled-chrome and same competing-h1 reason), and
// stay bound by the fo-badge rule through CONFORMANT_SURFACES.
//
// A page migrates by MOVING between lists, never by appearing on two — GATE 2c enforces that across
// all three.
const NORTH_STAR_COLLECTION_PAGES = [
  "modules/sales/OpportunityList.jsx",     // family 4b — the P1v4 reference collection
  "modules/workOrders/WorkOrdersList.jsx", // the WorkspaceIdentity header landed here first
  // MOVED here from CONFORMANT_WORKSPACES (Wave 2) by the Lists P2 Phase 4 migration — the first
  // page to cross the line this third list was added to make crossable. It dropped WorkspaceShell,
  // which GATE 2 demands of its former list and GATE 2d forbids of this one; without the move the
  // migration could not have merged.
  "modules/accounts/AccountsList.jsx",     // Phase 4
  "modules/sales/SalesOrdersList.jsx",     // Phase 5
  // TRANCHE 1 — catalog / reference families.
  "modules/inventory/PartMasterList.jsx",  // moved from CONFORMANT_WORKSPACES (Wave 4)
  "modules/equipment/EquipmentWorkspace.jsx",
  "modules/purchasing/Suppliers.jsx",
  "modules/inventory/Manufacturers.jsx",
  "modules/administration/EmployeesList.jsx",
  "modules/inventory/Warehouses.jsx",
  "modules/inventory/TruckInventory.jsx",
  "modules/purchasing/PurchaseOrders.jsx",
  "modules/inventory/Transfers.jsx",
  "modules/jobs/Jobs.jsx",
  // DISPATCH NORTH STAR P1 (2026-08-27). A board rather than a table, and a collection page all
  // the same: it is a workspace whose job is finding and placing work, and the artifact draws the
  // ratified collection header on it -- crumb, rule pair, serif title, workload summary line.
  // Listed here so GATE 2d holds it to that grammar instead of letting a board invent its own.
  "modules/dispatcherBoard/DispatcherBoard.jsx",
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

  it("GATE 2b — North Star record pages adopt the page grammar INSTEAD of the shell", () => {
    // The replacement obligation. A file here must carry both North Star page primitives...
    const missing = NORTH_STAR_RECORD_PAGES.filter((r) => {
      const src = read(r);
      return !/ns-page/.test(src) || !/RecordIdentity/.test(src);
    });
    expect(
      missing,
      `North Star record page missing ns-page / RecordIdentity:\n${missing.join("\n")}`,
    ).toEqual([]);

    // ...and must NOT also host WorkspaceShell. Running both doubles the chrome and gives the page
    // two competing h1 claims.
    const doubled = NORTH_STAR_RECORD_PAGES.filter((r) => /WorkspaceShell/.test(read(r)));
    expect(
      doubled,
      `North Star record page also hosts WorkspaceShell (pick one):\n${doubled.join("\n")}`,
    ).toEqual([]);
  });

  it("GATE 2b² — the North Star list is DERIVED, so it cannot be quietly emptied", () => {
    // A mutation proof of GATE 2b found this hole: deleting a file from NORTH_STAR_RECORD_PAGES
    // made the gate check fewer files and nothing failed. A membership list that only ever
    // constrains its own members can be shrunk to nothing and still pass — which is how a gate
    // stops guarding the thing it was written for.
    //
    // So membership is not optional. Any surface that composes the North Star page primitives must
    // be DECLARED, and the check runs against the whole tree rather than against the list.
    const undeclared = allFiles.map(rel)
      .filter((r) => {
        const src = read(r);
        return /className="ns-page"/.test(src) && /RecordIdentity/.test(src);
      })
      .filter((r) => !NORTH_STAR_RECORD_PAGES.includes(r));
    expect(
      undeclared,
      `These surfaces compose the North Star page grammar but are declared nowhere, so no gate covers them:\n${undeclared.join("\n")}`,
    ).toEqual([]);

    // And the reverse: a declared file that no longer exists, or no longer composes the grammar,
    // must be removed rather than left as a claim of coverage with nothing behind it.
    const surfaces = new Set(allFiles.map(rel));
    const stale = NORTH_STAR_RECORD_PAGES.filter((r) => !surfaces.has(r));
    expect(stale, `Declared North Star page is not a surface any more:\n${stale.join("\n")}`).toEqual([]);
  });

  it("GATE 2d — North Star collection pages adopt the collection grammar INSTEAD of the shell", () => {
    // The same replacement obligation GATE 2b places on record pages, for the surface P2 governs.
    // The primitive is WorkspaceIdentity rather than RecordIdentity: a collection's header answers
    // "what is this set and what about it needs me", a record's answers "which one is this".
    const missing = NORTH_STAR_COLLECTION_PAGES.filter((r) => !/import\s+WorkspaceIdentity\s+from/.test(read(r)));
    expect(
      missing,
      `North Star collection page missing WorkspaceIdentity:\n${missing.join("\n")}`,
    ).toEqual([]);

    // ...and must NOT also host WorkspaceShell, for the reason GATE 2b records: two shells double
    // the chrome and both claim the h1 (ND-4).
    const doubled = NORTH_STAR_COLLECTION_PAGES.filter((r) => /WorkspaceShell/.test(read(r)));
    expect(
      doubled,
      `North Star collection page also hosts WorkspaceShell (pick one):\n${doubled.join("\n")}`,
    ).toEqual([]);
  });

  it("GATE 2d² — collection membership is DERIVED, so it cannot be quietly emptied", () => {
    // The mutation hole GATE 2b² found, closed here before it can be dug a second time: a list that
    // only ever constrains its own members can be shrunk to nothing and still pass. So the check
    // runs against the WHOLE TREE and membership is compulsory.
    //
    // The probe is the IMPORT rather than the bare word, so `shared/ui/WorkspaceIdentity.jsx` — which
    // contains its own name and is the primitive, not a consumer — does not report itself.
    const undeclared = allFiles.map(rel)
      .filter((r) => /import\s+WorkspaceIdentity\s+from/.test(read(r)))
      .filter((r) => !NORTH_STAR_COLLECTION_PAGES.includes(r));
    expect(
      undeclared,
      `These surfaces compose the North Star collection grammar but are declared nowhere, so no gate covers them:\n${undeclared.join("\n")}`,
    ).toEqual([]);

    // And the reverse: a declared file that no longer exists must be removed rather than left as a
    // claim of coverage with nothing behind it.
    const surfaces = new Set(allFiles.map(rel));
    const stale = NORTH_STAR_COLLECTION_PAGES.filter((r) => !surfaces.has(r));
    expect(stale, `Declared North Star collection page is not a surface any more:\n${stale.join("\n")}`).toEqual([]);
  });

  it("GATE 2c — a page cannot be on two shell lists", () => {
    // Otherwise two gates would demand opposite things of the same file, and whichever ran first
    // would decide. A migration MOVES a page between the lists; it never adds it twice.
    //
    // Now THREE lists, so all three pairs are compared. The pair that matters most in practice is
    // collection-vs-workspace: every list still on WorkspaceShell (AccountsList, PartsList,
    // PartMasterList, TruckInventory...) migrates by moving across exactly that line.
    const pairs = [
      ["North Star record", NORTH_STAR_RECORD_PAGES, "conformant workspace", CONFORMANT_WORKSPACES],
      ["North Star collection", NORTH_STAR_COLLECTION_PAGES, "conformant workspace", CONFORMANT_WORKSPACES],
      ["North Star collection", NORTH_STAR_COLLECTION_PAGES, "North Star record", NORTH_STAR_RECORD_PAGES],
    ];
    for (const [leftName, left, rightName, right] of pairs) {
      const both = left.filter((r) => right.includes(r));
      expect(both, `File is on both the ${leftName} and ${rightName} lists:\n${both.join("\n")}`).toEqual([]);
    }
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
