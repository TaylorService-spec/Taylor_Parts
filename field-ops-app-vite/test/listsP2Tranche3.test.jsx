// LISTS P2 TRANCHE 3 — the operational movement families.
//
// GOVERNANCE: docs/north-star/lists/, Owner continue-ruling 2026-08-27.
//
// Purchase Orders · Transfers. Two rulings, both of them about resisting a helpful join:
//
//   PURCHASE ORDERS — "If the collection projection does not own money, do NOT join, derive,
//   fan-out, or borrow money from another collection merely so the List can display a total. The
//   existence of financial truth elsewhere does not make it a Purchase Order list fact."
//
//   TRANSFERS — the raw part id rendered as a label is an R3 defect. "Correct the label only
//   through an EXISTING governed reference/resolver if one already exists and is legitimate for
//   this surface... If no governed label resolution exists, classify the presentation as BLOCKED /
//   unresolved rather than inventing one."

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { transferOrderEntity } from "../src/metadata/definitions/transferOrder.js";
import { purchaseOrderEntity } from "../src/metadata/definitions/purchaseOrder.js";
import { UNRESOLVED_REFERENCE_LABEL } from "../src/metadata/referenceResolution.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PURCHASE_ORDERS = read("src/modules/purchasing/PurchaseOrders.jsx");
const TRANSFERS = read("src/modules/inventory/Transfers.jsx");

describe("both wear the collection header", () => {
  for (const [name, src] of [["Purchase Orders", PURCHASE_ORDERS], ["Transfers", TRANSFERS]]) {
    it(`${name} composes WorkspaceIdentity and hosts no WorkspaceShell`, () => {
      expect(src, name).toMatch(/import WorkspaceIdentity from/);
      expect(src, name).not.toMatch(/^import WorkspaceShell from/m);
      expect(code(src), name).not.toMatch(/WorkspaceHeader/);
    });
  }
});

// ═════════════════════════════════════════ Purchase Orders — the money that is not this list's

describe("Purchase Orders shows no money, because this projection owns none", () => {
  it("the entity declares no money field of any kind", () => {
    // Not asserted on the screen alone: if a field appeared here, the next migration would render
    // it in good faith.
    expect(purchaseOrderEntity.fields.some((f) => /dollar|total|cost|price|amount|minor/i.test(f.id))).toBe(false);
  });

  it("the screen borrows no total from the other collection", () => {
    // `totalCost` is written by procurementService into `purchase_orders`. The reachable list reads
    // `reorder_purchase_orders`. Two collections, one name — attaching that genuine number to these
    // rows would be worse than showing nothing, because it would be believed.
    const c = code(PURCHASE_ORDERS);
    for (const borrowed of [/totalCost/, /purchase_orders/, /salesOrderDollars/, /formatMinor/, /resolveMoneyCell/]) {
      expect(c, `must not reach for ${borrowed}`).not.toMatch(borrowed);
    }
    // ...and the reason survives in the source, so the absence reads as a decision.
    expect(PURCHASE_ORDERS).toMatch(/does not make it a Purchase Order list fact/);
  });

  it("no currency is FORMATTED anywhere on the page", () => {
    // Checked as "no formatter and no symbol literal" rather than by hunting for a bare `$`, which
    // in JSX is mostly template-literal interpolation and would have made this assertion noise.
    // The first version did exactly that and failed on `${row...}` — a test that cannot tell a
    // currency from a string substitution is not testing currency.
    const c = code(PURCHASE_ORDERS);
    expect(c).not.toMatch(/Intl\.NumberFormat/);
    expect(c).not.toMatch(/currency/i);
    expect(c).not.toMatch(/["'`]\$["'`]/);
  });

  it("the header counts rows and flags receipt candidates, and nothing else", () => {
    expect(PURCHASE_ORDERS).toMatch(/count=\{view\.rows\.length\}/);
    expect(PURCHASE_ORDERS).toMatch(/view\.summary\.receiptCandidates > 0/);
  });

  it("NO CREATE ACTION — a purchase order is placed from the reorder workflow", () => {
    expect(code(PURCHASE_ORDERS)).not.toMatch(/action=\{/);
    expect(PURCHASE_ORDERS).toMatch(/not from\s*\n?\s*\/\/ this read-only screen|read-only screen/);
  });
});

// ═════════════════════════════════════════ Transfers — R3, corrected by stating the absence

describe("Transfers no longer prints a document id as a label", () => {
  it("partId is a REFERENCE, which is what made rendering it a defect", () => {
    const field = transferOrderEntity.fields.find((f) => f.id === "partId");
    expect(field.type).toBe("REFERENCE");
    expect(field.referenceTo).toBe("part");
  });

  it("the id is GONE from the visible cell", () => {
    // It was the link's own text: every Transfer row put a Firestore id in front of an operator.
    expect(code(TRANSFERS)).not.toMatch(/>\{row\.partId\}</);
  });

  it("the cell states the honest absence, in the platform's shared vocabulary", () => {
    // Not a bespoke sentence: the same words every other unresolved reference uses, so a reader
    // meets one vocabulary rather than one per screen.
    expect(TRANSFERS).toMatch(/UNRESOLVED_REFERENCE_LABEL/);
    expect(UNRESOLVED_REFERENCE_LABEL).toBe("Unresolved reference");
  });

  it("NO READ WAS ADDED to resolve the name", () => {
    // The only resolver that could supply one issues fetchPartMasterList() — a whole-catalogue
    // read. The ruling forbids widening the read, adding a resolver callable, adding a client read,
    // or fabricating a name. So the reference is BLOCKED and says so.
    const c = code(TRANSFERS);
    for (const forbidden of [/useCanonicalPartNames/, /fetchPartMasterList/, /partNamesBoundaryKey/, /httpsCallable/]) {
      expect(c, `must not add ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("the id survives ONLY in the href, where it is governed", () => {
    // The ruling permits it for identity and navigation. `/inventory/:partId` is a mounted route,
    // so the row still opens the part record — where the name this cell cannot name is written
    // down. An honest link to the answer beats a confident label that is a database key.
    expect(TRANSFERS).toMatch(/buildRowHref\(partIndexList\.rowNavigationTo, row\.partId\)/);
  });

  it("an ABSENT partId is a dash, not an unresolved reference", () => {
    // Two different facts: "there is a part and we cannot name it" versus "no part is recorded".
    expect(TRANSFERS).toMatch(/row\.partId \? \(/);
    expect(TRANSFERS).toMatch(/<span className="fo-muted">—<\/span>/);
  });

  it("the header count is exact, because this read is not paged", () => {
    expect(TRANSFERS).toMatch(/count=\{rows\.length\}/);
  });
});
