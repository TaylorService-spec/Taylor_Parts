// DQ-027 on the surfaces: a part whose ledger cannot be read is LISTED as unavailable (never dropped, never
// a number); an unattributable row makes the section unavailable; the hook fails closed for callers that
// have not opted in to partial integrity.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor, renderHook } from "@testing-library/react";

const rows = vi.hoisted(() => ({ value: [] }));
vi.mock("../src/services/operationsQueries", () => ({ fetchInventoryTransactions: vi.fn(async () => rows.value) }));

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

describe("useInventoryLedger integrity", () => {
  it("DEFAULT: an unreadable row FAILS the read (the old contract cannot say 'some parts')", async () => {
    rows.value = [good("A"), { ...good("B"), quantity: "oops" }];
    const { result } = renderHook(() => useInventoryLedger());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.code).toBe("LEDGER_ROW_UNREADABLE");
    expect(result.current.healthEntries).toEqual([]);
  });
  it("OPTED IN: unaffected parts keep true figures; the affected part is disclosed, not dropped", async () => {
    rows.value = [good("A", 5), { ...good("B"), quantity: "oops" }];
    const { result } = renderHook(() => useInventoryLedger({ allowPartial: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.healthEntries.map((e) => [e.partId, e.stock.availableStock])).toEqual([["A", 5]]);
    expect(result.current.integrity.unavailablePartIds).toEqual(["B"]);
  });
  it("OPTED IN but unattributable: still a failed read", async () => {
    rows.value = [good("A"), { schemaVersion: 2, type: "TRANSFER_OUT", quantity: 1 }];
    const { result } = renderHook(() => useInventoryLedger({ allowPartial: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.integrity?.state).toBe("UNAVAILABLE");
  });
});
