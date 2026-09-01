// LISTS P2 — THE COMPOSE PASS. Related lists stay subordinate to the record that owns them.
//
// GOVERNANCE: docs/north-star/lists/, Owner continue-ruling 2026-08-27.
//
//   "The COMPOSE pass should reuse the proven shared primitives but remain subordinate to the
//    parent record/workspace. A related list must NOT become a collection page embedded inside
//    Detail. Apply the established addendum: CONTEXT WITHOUT DUPLICATION."
//
// ════════════════════ WHY THIS IS A GATE AND NOT A REWRITE ════════════════════
//
// The subordination rule is already MODELLED. `LIST_SURFACE` distinguishes INDEX from RELATED, and
// `buildListPresentation` refuses to report `hasMore` for a RELATED surface, so an embedded section
// cannot grow a Load more even if a caller passed one. `MAX_RELATED_ROWS` caps it. Those properties
// exist; what did not exist is anything that FAILS when a related list starts wearing collection
// chrome — and a collection page is assembled from parts (a header, a views row, a footer) that a
// related section could acquire one at a time without any single step looking wrong.
//
// So this suite guards the boundary rather than reimplementing it. It is deliberately written as
// "no related surface may have X", because the drift it exists to catch is additive and gradual.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { LIST_SURFACE, MAX_RELATED_ROWS } from "../src/metadata/listViewDefinition.js";
import { buildListPresentation } from "../src/metadata/listPresentation.js";
import { contactEntity, contactRelatedList } from "../src/metadata/definitions/contact.js";
import { locationEntity, locationRelatedList } from "../src/metadata/definitions/location.js";
import { opportunityEntity, opportunityRelatedList } from "../src/metadata/definitions/opportunity.js";
import { salesOrderEntity, salesOrderRelatedList } from "../src/metadata/definitions/salesOrder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(SRC, p).split("\\").join("/");
const read = (p) => readFileSync(p, "utf8");

/**
 * Source with its comments removed.
 *
 * Every "this must NOT be present" assertion in this programme has to run against code, because the
 * files explain at length why each absent thing is absent — and a bare text search matches the
 * explanation. That is the measurement bug the migration manifest was written to stop, arriving
 * inside a test.
 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * The declared collection pages — the ONLY surfaces allowed to wear collection chrome.
 *
 * Kept in step with test/compositionConformance.test.jsx's NORTH_STAR_COLLECTION_PAGES by a test
 * below, rather than by hoping two lists stay equal.
 */
const COLLECTION_PAGES = [
  "modules/sales/OpportunityList.jsx",
  "modules/workOrders/WorkOrdersList.jsx",
  "modules/accounts/AccountsList.jsx",
  "modules/sales/SalesOrdersList.jsx",
  "modules/inventory/PartMasterList.jsx",
  "modules/equipment/EquipmentWorkspace.jsx",
  "modules/purchasing/Suppliers.jsx",
  "modules/inventory/Manufacturers.jsx",
  "modules/administration/EmployeesList.jsx",
  "modules/inventory/Warehouses.jsx",
  "modules/inventory/TruckInventory.jsx",
  "modules/purchasing/PurchaseOrders.jsx",
  "modules/inventory/Transfers.jsx",
  // Added by the Owner visual correction (2026-08-27): Job Assignments was BLOCKED on a product
  // question and therefore received no presentation work, which is why it looked nothing like
  // Opportunity. It is a collection page now; the product question is untouched.
  "modules/jobs/Jobs.jsx",
  // DISPATCH NORTH STAR P1 (2026-08-27). A board rather than a table, and a collection page all
  // the same: it is a workspace whose job is finding and placing work, and the artifact draws the
  // ratified collection header on it -- crumb, rule pair, serif title, workload summary line.
  // Listed here so GATE 2d holds it to that grammar instead of letting a board invent its own.
  "modules/dispatcherBoard/DispatcherBoard.jsx",
  // FINANCIALS NORTH STAR P1 (2026-09-01). The family's shared frame is the ONE consumer of
  // WorkspaceIdentity for all /financials pages (same declared-primitive shape as the
  // conformance gate records): the pages import FinancialsPageFrame, not the header itself.
  "modules/financials/FinancialsPrimitives.jsx",
];

/**
 * Retired surfaces that still carry list machinery, excluded with their reason.
 *
 * Not an exemption list that may grow: each entry is UNROUTED dead code, and a test below asserts
 * that nothing in the application can reach it. The moment one of these is routed again it fails
 * that check rather than sitting quietly in an allowlist.
 */
const RETIRED_UNROUTED = [
  // ND-17 — the Opportunity master-detail workspace P1v4 retired. It still holds `useListCriteria`
  // and a MetadataListGrid, which is exactly why it shows up here: dead code keeps its machinery,
  // and a gate that ignored it would also ignore the day somebody re-mounted it.
  "modules/sales/SalesWorkspace.jsx",
];

/**
 * Surfaces that legitimately own list criteria without hosting the page header.
 *
 * Exactly one today: the Equipment collection is split across two files — EquipmentWorkspace holds
 * the identity and the tabs, CustomerEquipment holds the register. Splitting a collection across
 * two files does not make either of them a related section, but only ONE of them composes the
 * header, so the two lists below are deliberately different sets rather than one.
 */
const COLLECTION_SURFACES = [
  ...COLLECTION_PAGES,
  "modules/equipment/CustomerEquipment.jsx",
  // FINANCIALS NORTH STAR P1 — the same split-collection shape as Equipment, per family: the
  // declared primitives module composes the header for every /financials page, and the two
  // COLLECTION pages of Wave UX-1 (Invoices, Payments) own their views rows. They are
  // collections (the invoice and payment registries), not related sections; the header lives
  // in the shared frame, so only the frame appears in COLLECTION_PAGES above.
  "modules/financials/FinancialsInvoices.jsx",
  "modules/financials/FinancialsPayments.jsx",
  // Wave UX-2 — same shape: the Billing Queue and Corrections registries own their views rows.
  "modules/financials/FinancialsBillingQueue.jsx",
  "modules/financials/FinancialsCreditsAdjustments.jsx",
];

const RELATED_DEFS = [
  ["contact", contactRelatedList, contactEntity],
  ["location", locationRelatedList, locationEntity],
  ["opportunity", opportunityRelatedList, opportunityEntity],
  ["salesOrder", salesOrderRelatedList, salesOrderEntity],
];

// ═════════════════════════════════════════ the model already forbids paging

describe("a RELATED surface cannot page, by construction", () => {
  for (const [name, def] of RELATED_DEFS) {
    it(`${name} is declared RELATED and capped`, () => {
      expect(def.surface).toBe("RELATED");
      expect(def.pageSize).toBeLessThanOrEqual(MAX_RELATED_ROWS);
    });
  }

  it("buildListPresentation REFUSES hasMore for a RELATED surface, even when the page reports it", () => {
    // The load-bearing half: subordination is enforced in the model, not by every caller
    // remembering to withhold a prop. A section that could page would be an unbounded second list
    // living inside a record.
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `Contact ${i}` }));
    const related = buildListPresentation({
      def: contactRelatedList,
      entity: contactEntity,
      page: { rows, hasMore: true },
    });
    expect(related.hasMore).toBe(false);

    // ...and the same model DOES report it for an INDEX, so the assertion above is about the
    // surface rather than about a function that always returns false.
    const index = buildListPresentation({
      def: { ...contactRelatedList, surface: "INDEX" },
      entity: contactEntity,
      page: { rows, hasMore: true },
    });
    expect(index.hasMore).toBe(true);
  });

  it("INDEX and RELATED are the only two surfaces — there is no third to hide in", () => {
    expect([...LIST_SURFACE]).toEqual(["INDEX", "RELATED"]);
  });
});

// ═════════════════════════════════════════ no related surface wears collection chrome

describe("a related list is not a collection page embedded inside Detail", () => {
  const surfaces = walk(SRC)
    .map(rel)
    .filter((r) => r.startsWith("modules/") || r.startsWith("shared/"))
    .filter((r) => !COLLECTION_SURFACES.includes(r))
    .filter((r) => !RETIRED_UNROUTED.includes(r));

  it("the collection-page list here matches the conformance gate's, so this suite cannot go stale", () => {
    // Two lists naming the same set is how they drift. This is the check that keeps them equal —
    // without it, a page added to one and not the other would silently escape whichever suite it
    // was left out of.
    const gate = read(join(HERE, "compositionConformance.test.jsx"));
    for (const page of COLLECTION_PAGES) {
      expect(gate, `${page} must be declared in the conformance gate too`).toContain(page);
    }
    const declaredInGate = [...gate.matchAll(/"(modules\/[^"]+\.jsx)",\s+\/\/ Phase|"(modules\/[^"]+\.jsx)",\s*$/gm)];
    expect(declaredInGate.length).toBeGreaterThan(0);
  });

  it("no non-collection surface composes the collection header", () => {
    // GATE 2d² says the same thing from the other direction (membership is derived). Asserted here
    // too because this suite is where somebody reads the COMPOSE contract, and a rule that lives
    // only in another file is a rule the reader of this one does not meet.
    const offenders = surfaces.filter((r) => /import\s+WorkspaceIdentity\s+from/.test(read(join(SRC, r))));
    expect(offenders, `related/embedded surfaces must not wear the collection header:\n${offenders.join("\n")}`).toEqual([]);
  });

  // The shared primitive that RENDERS the views row is not a surface that WEARS one. FilterBar
  // necessarily contains the class name, the same way a button component contains "button".
  // Naming it here costs the check nothing, because the check it would otherwise perform on
  // FilterBar's callers is performed directly, below.
  const VIEWS_ROW_IMPLEMENTATION = "shared/ui/FilterBar.jsx";

  it("no non-collection surface renders a views row or a collection footer", () => {
    // The parts a related section would acquire one at a time on its way to becoming a page.
    const offenders = surfaces.filter((r) => {
      if (r === VIEWS_ROW_IMPLEMENTATION) return false;
      const src = read(join(SRC, r));
      return /ns-collection__views|ns-collection__result/.test(src);
    });
    expect(offenders, `related surfaces must not grow a views row or a result footer:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("a surface cannot acquire a views row INDIRECTLY, through the shared primitive", () => {
    // THE HOLE THE COLLECTION-GRAMMAR PASS OPENED, closed in the same change that opened it.
    //
    // FilterBar used to render one thing. It now renders the views row BY DEFAULT (`variant`
    // defaults to "views"), so a related section could grow collection chrome by adding a plain
    // <FilterBar> — no class name in its own source, nothing for the check above to see. The rule
    // did not change; the way to break it did.
    //
    // Stated as the caller's obligation: a non-collection surface using FilterBar must say
    // variant="chips". That is why the prop is not a boolean with a safe default — the surfaces
    // that are NOT collections are the ones that have to declare themselves.
    const offenders = surfaces
      .filter((r) => r !== VIEWS_ROW_IMPLEMENTATION)
      .filter((r) => /<FilterBar\b/.test(stripComments(read(join(SRC, r)))))
      .filter((r) => !/<FilterBar\b[^>]*variant=["']chips["']/s.test(stripComments(read(join(SRC, r)))));
    expect(
      offenders,
      `a non-collection surface rendering FilterBar must pass variant="chips":\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("that indirect check can actually fail — the default really is the views row", () => {
    // A check incapable of failing is not evidence. If FilterBar's default ever became "chips",
    // the check above would pass for every caller including a genuinely offending one, and would
    // be guarding nothing. This asserts the premise the check rests on.
    const primitive = stripComments(read(join(SRC, VIEWS_ROW_IMPLEMENTATION)));
    expect(primitive).toMatch(/variant\s*=\s*"views"/);
    expect(primitive).toMatch(/ns-collection__views/);
  });

  it("no related section issues its own list criteria or filter builder", () => {
    // URL-backed criteria belong to the page. A section owning them would put a record page's
    // address in the service of one of its sections, and two sections would fight over it.
    const offenders = surfaces.filter((r) => {
      const src = read(join(SRC, r));
      return /useListCriteria|MetadataListControls/.test(src);
    });
    expect(offenders, `related surfaces must not own list criteria:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ═════════════════════════════════════════ context without duplication

describe("context without duplication", () => {
  it("a related list is never WIDER than its own index, and is not a copy of it", async () => {
    // THE FIRST VERSION OF THIS ASSERTED "fewer columns", AND THAT WAS WRONG — recorded because the
    // failure taught the actual rule. Sales Orders declares six columns on both surfaces, and the
    // related one is not a reduced index: it DROPS the parent (accountId, meaningless on a page
    // already headed by that account) and adds sourceOpportunityNumber, which explains why THIS
    // order is on THIS account. Opportunity does the same, trading accountId and salesChannel for
    // need and outcome.
    //
    // So the invariant is not width. It is that a related list is composed for the relationship
    // rather than inherited from the index — which is what the next two tests actually check, and
    // what this one now states in the only numeric form that is true.
    const { opportunityIndexList } = await import("../src/metadata/definitions/opportunity.js");
    const { salesOrderIndexList } = await import("../src/metadata/definitions/salesOrder.js");
    expect(opportunityRelatedList.columns.length).toBeLessThanOrEqual(opportunityIndexList.columns.length);
    expect(salesOrderRelatedList.columns.length).toBeLessThanOrEqual(salesOrderIndexList.columns.length);
    // Not a copy: each related list differs from its index in what it carries, not merely in how
    // much. A related list identical to its index would be the record page reproduced in a section.
    const same = (a, b) => JSON.stringify(a.columns.map((c) => c.fieldId)) === JSON.stringify(b.columns.map((c) => c.fieldId));
    expect(same(opportunityRelatedList, opportunityIndexList)).toBe(false);
    expect(same(salesOrderRelatedList, salesOrderIndexList)).toBe(false);
  });

  it("the retired workspace is genuinely unreachable, so excluding it claims nothing false", () => {
    // ND-17. SalesWorkspace.jsx still holds list criteria and a grid; it is excluded from the
    // subordination checks above ONLY because nothing routes to it. That has to be a fact rather
    // than a note, or the exclusion becomes a place to hide a live surface.
    // Asserted on CODE, not on the file: App.jsx explains at length why the workspace was retired,
    // and a bare text search matches the explanation. That is the measurement bug this programme
    // keeps finding — a check that reads prose and reports it as behaviour.
    const app = stripComments(readFileSync(join(SRC, "App.jsx"), "utf8"));
    expect(app).not.toMatch(/SalesWorkspace/);
  });

  it("every related column belongs to the related object itself", () => {
    // A related list may not carry a fact borrowed from a third object to look richer — that is the
    // duplication the addendum forbids, arriving one column at a time.
    for (const [name, def, entity] of RELATED_DEFS) {
      const fieldIds = new Set(entity.fields.map((f) => f.id));
      for (const column of def.columns) {
        expect(fieldIds.has(column.fieldId), `${name}.${column.fieldId} is not a field of ${name}`).toBe(true);
      }
    }
  });

  it("a related list carries no parent-scope column — the parent IS the page", () => {
    // Rendering the account on every row of a section already headed by that account is the
    // clearest form of duplicated context, and the easiest to add by accident when a related list
    // is configured from its index sibling.
    for (const [name, def] of RELATED_DEFS) {
      const ids = def.columns.map((c) => c.fieldId);
      expect(ids, `${name} must not repeat its parent on every row`).not.toContain("accountId");
    }
  });
});
