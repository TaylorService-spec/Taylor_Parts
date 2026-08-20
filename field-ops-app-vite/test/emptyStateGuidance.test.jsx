// Contextual-help slice -- render tests for EmptyState's `guidance` slot.
//
// The load-bearing rule is the variant scope, and it is enforced in the component
// rather than at the ~30 call sites on purpose: a "filtered" empty means the user
// already HAS records and merely over-filtered, so re-explaining what the entity is
// at that moment is noise -- and it would reappear on every filter change. Callers
// are therefore free to pass `guidance` unconditionally; only "database" renders it.
// Without this test, a well-meaning refactor could quietly move the decision back
// out to callers and the noise would return one screen at a time.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import EmptyState from "../src/shared/ui/EmptyState.jsx";

afterEach(cleanup);

const GUIDANCE = "A work order is the customer-facing service record for one job.";

describe("EmptyState guidance slot", () => {
  it("renders guidance on the database variant (the first-run empty)", () => {
    render(<EmptyState variant="database" title="No work orders yet" guidance={GUIDANCE} />);
    const el = screen.getByText(GUIDANCE);
    expect(el.className).toContain("fo-state-guidance");
    expect(el.hasAttribute("data-state-guidance")).toBe(true);
  });

  it("suppresses guidance on the filtered variant even when the caller passes it", () => {
    render(<EmptyState variant="filtered" message="No matches." guidance={GUIDANCE} />);
    expect(screen.queryByText(GUIDANCE)).toBeNull();
    expect(document.querySelector("[data-state-guidance]")).toBeNull();
  });

  it("omits the guidance element entirely when no guidance is supplied", () => {
    render(<EmptyState variant="database" title="No work orders yet" message="None yet." />);
    expect(document.querySelector(".fo-state-guidance")).toBeNull();
  });

  it("keeps guidance distinct from the message -- both render, message stays muted", () => {
    render(<EmptyState variant="database" message="None yet." guidance={GUIDANCE} />);
    const message = screen.getByText("None yet.");
    expect(message.className).toContain("fo-muted");
    expect(message.className).toContain("fo-state-message");
    // Guidance is deliberately NOT fo-muted: it is the one line a first-run user is
    // meant to read, so it must not be de-emphasised below the message above it.
    expect(screen.getByText(GUIDANCE).className).not.toContain("fo-muted");
  });

  it("does not add alert semantics -- an empty collection is not an error", () => {
    const { container } = render(<EmptyState variant="database" guidance={GUIDANCE} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GUIDANCE THROUGH THE METADATA LIST RUNTIME.
//
// Four of the eight screens this slice originally annotated by hand (Customers,
// Warehouses, Suppliers, and the Account's Locations section) were migrated to the
// metadata list runtime while this work sat open, and their hand-written EmptyState call
// sites no longer exist. Re-adding them would have resurrected deleted code.
//
// The equivalent in the new architecture is the list DEFINITION: emptyGuidance travels
// definition → buildListPresentation → MetadataListGrid → EmptyState, which means every
// metadata-driven surface gets it at once instead of one call site at a time — and the
// text lives next to what the entity means rather than next to one screen that shows it.
// ─────────────────────────────────────────────────────────────────────────────
import { buildListPresentation, emptyGuidanceFor } from "../src/metadata/listPresentation.js";
import { accountIndexList } from "../src/metadata/definitions/account.js";
import { warehouseIndexList } from "../src/metadata/definitions/warehouse.js";
import { supplierIndexList } from "../src/metadata/definitions/supplier.js";
import { locationRelatedList } from "../src/metadata/definitions/location.js";

describe("emptyGuidanceFor (the state rule)", () => {
  const def = { emptyGuidance: "What this collection is." };

  it("shows guidance on a first-run EMPTY", () => {
    expect(emptyGuidanceFor("EMPTY", def)).toBe("What this collection is.");
  });

  it("stays silent on FILTERED — the reader already has records and merely over-filtered", () => {
    expect(emptyGuidanceFor("FILTERED", def)).toBeNull();
  });

  it("stays silent on DENIED and UNAVAILABLE — describing the collection would imply the read succeeded and found nothing", () => {
    expect(emptyGuidanceFor("DENIED", def)).toBeNull();
    expect(emptyGuidanceFor("UNAVAILABLE", def)).toBeNull();
  });

  it("a definition that declares nothing renders exactly as before", () => {
    expect(emptyGuidanceFor("EMPTY", { label: "Widgets" })).toBeNull();
    expect(emptyGuidanceFor("EMPTY", null)).toBeNull();
  });
});

describe("the migrated screens kept their authored guidance", () => {
  // Each of these carried a hand-written paragraph before its screen was migrated. The
  // text survived the migration; only where it lives changed.
  it.each([
    ["Customers", accountIndexList, /customer is the account everything else hangs off/i],
    ["Warehouses", warehouseIndexList, /stocking locations inventory is received into/i],
    ["Suppliers", supplierIndexList, /vendors parts are purchased from/i],
    ["Account locations", locationRelatedList, /physical site where service happens/i],
  ])("%s", (_name, def, pattern) => {
    expect(def.emptyGuidance).toMatch(pattern);
  });

  it("reaches the presentation an empty list actually renders from", () => {
    const p = buildListPresentation({ def: warehouseIndexList, entity: null, page: { rows: [], hasMore: false } });
    expect(p.state).toBe("EMPTY");
    expect(p.emptyGuidance).toMatch(/stocking locations/i);
    // and the message is still its own, separate statement
    expect(p.emptyMessage).toBeTruthy();
    expect(p.emptyMessage).not.toBe(p.emptyGuidance);
  });
});
