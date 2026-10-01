// DQ-027 on the surfaces: a part whose ledger cannot be read is LISTED as unavailable (never dropped, never
// a number); an unattributable row makes the section unavailable; the hook fails closed for callers that
// have not opted in to partial integrity.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor, renderHook } from "@testing-library/react";

// EOS (Controller PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01): the hook reads the governed PostgreSQL reads, never
// Firestore inventory_transactions. The panels' DQ-027 disclosures are unchanged and still proven below.
const eos = vi.hoisted(() => ({ onHand: { scopedWarehouseIds: [], rows: [], totals: [] }, history: { items: [] }, fail: null }));
vi.mock("../src/services/partsOperationsReads.js", () => ({
  fetchInventoryPosition: vi.fn(async () => { if (eos.fail) throw eos.fail; return eos.onHand; }),
  fetchInventoryMovements: vi.fn(async () => { if (eos.fail) throw eos.fail; return eos.history; }),
}));

import InventoryHealthPanel from "../src/modules/operations/panels/InventoryHealthPanel.jsx";
import ProcurementPanel from "../src/modules/operations/panels/ProcurementPanel.jsx";
import { useInventoryLedger } from "../src/hooks/useInventoryLedger.js";

afterEach(cleanup);

const ts = { toMillis: () => 1_700_000_000_000 };
const good = (partId, quantity = 3) => ({
  id: `t-${partId}`, schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE",
  location: { type: "WAREHOUSE", locationId: "wh" }, quantity, sourceObject: { type: "RECEIVING_ORDER", id: `s-${partId}` },
  idempotencyKey: `k-${partId}`, actor: { kind: "USER", id: "u" }, occurredAt: 1_700_000_000_000, recordedAt: ts,
  fingerprint: "0123456789abcdef",
});

describe("InventoryHealthPanel integrity", () => {
  it("lists an unavailable part as a row with the reason, and says the rest is unaffected", () => {
    render(<InventoryHealthPanel healthEntries={[]} unavailablePartIds={["PRT-BAD"]} />);
    expect(screen.getByText("PRT-BAD")).toBeTruthy();
    expect(document.body.textContent).toMatch(/a ledger record for this part cannot be read/);
    expect(document.body.textContent).toMatch(/Incomplete: 1 part cannot be forecast/);
    expect(document.body.textContent).not.toMatch(/No ledger activity yet/);
  });
  it("an unattributable row makes the whole panel unavailable", () => {
    render(<InventoryHealthPanel healthEntries={[]} ledgerUnavailable />);
    expect(document.body.textContent).toMatch(/Inventory health is unavailable/);
    expect(document.body.textContent).not.toMatch(/No ledger activity yet/);
  });
});

describe("ProcurementPanel integrity", () => {
  it("never says 'nothing needs reordering' when parts were not assessed", () => {
    render(<ProcurementPanel purchaseOrders={[]} suppliers={[]} procurementDrafts={[]} ledgerIntegrity={{ state: "INCOMPLETE", unavailablePartIds: ["X", "Y"] }} />);
    expect(document.body.textContent).toMatch(/2 parts were not assessed/);
    expect(document.body.textContent).not.toMatch(/nothing currently needs reordering/);
  });
});

describe("useInventoryLedger over the governed PostgreSQL reads", () => {
  const movement = (partId, quantityDelta, type = "RECEIVED") => ({ movementId: `m-${partId}-${quantityDelta}`, partId, movementType: type, quantityDelta,
    locationType: "WAREHOUSE", locationId: "wh-phx", warehouseId: "wh-phx", sourceKind: "RECEIVING_ORDER", sourceId: "rcv-1", serialNumber: null,
    occurredAt: "2026-10-01T15:00:00.000Z" });

  it("STOCK is the server's authoritative on-hand -- never re-derived client-side from the movement rows", async () => {
    eos.fail = null;
    eos.onHand = { scopedWarehouseIds: ["wh-phx"], rows: [], totals: [{ partId: "PRT-FAN", onHand: 6 }] };
    eos.history = { items: [movement("PRT-FAN", 6), movement("PRT-FAN", 99, "ADJUSTED")] }; // a history that would sum differently
    const { result } = renderHook(() => useInventoryLedger());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.healthEntries.map((e) => [e.partId, e.stock.availableStock])).toEqual([["PRT-FAN", 6]]);
    expect(result.current.transactions.map((t) => [t.partId, t.type, t.quantity])).toEqual([["PRT-FAN", "RECEIVED", 6], ["PRT-FAN", "ADJUSTED", 99]]);
    expect(result.current.integrity.state).toBe("COMPLETE");
  });

  it("no warehouse scope is an honest empty answer, not an error", async () => {
    eos.fail = null;
    eos.onHand = { scopedWarehouseIds: [], rows: [], totals: [] };
    eos.history = { items: [] };
    const { result } = renderHook(() => useInventoryLedger({ allowPartial: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([result.current.error, result.current.healthEntries]).toEqual([null, []]);
  });

  it("a refused or failed read is a FAILED read -- never a silent empty list", async () => {
    eos.fail = Object.assign(new Error("denied"), { code: "FORBIDDEN" });
    const { result } = renderHook(() => useInventoryLedger());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.code).toBe("FORBIDDEN");
    expect(result.current.healthEntries).toEqual([]);
  });

  it("imports no Firestore read", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/hooks/useInventoryLedger.js", "utf8");
    expect(src).not.toMatch(/operationsQueries|firebase\/firestore|inventory_transactions"/);
  });
});
