// THE PART BALANCE, CLIENT SIDE (Firebase exit B3-x) -- the readPartBalance transport, its hook and its pure view.
//
// The server is proved against PostgreSQL (functions/test/partBalancePostgres.test.mjs). These prove what the browser does with the answer:
// UNKNOWN is never turned into 0, a refusal is not a failure is not a switched-off read, and nothing is asked where the environment has
// not switched the read on.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { balanceProjection, fetchBalanceForScan, fetchPartBalance } from "../src/services/partsOperationsReads.js";
import { usePartBalance, BALANCE_STATUS } from "../src/hooks/usePartBalance.js";
import { partBalanceView, partPurchasingSection, partNoHistoryRecommendation } from "../src/domain/partsNorthStar.js";

afterEach(cleanup);

const K = (value) => ({ state: "KNOWN", value });
const UNKNOWN = { state: "UNKNOWN", value: null };
const SERVER = {
  partId: "P1", trackingMode: "NONE", scopedWarehouseIds: ["wh-1"],
  onHand: K(13), reserved: K(3), available: K(10), onOrder: K(7),
  byLocation: [{ warehouseId: "wh-1", quantity: 13 }],
};
const answering = (result) => ({ call: vi.fn().mockResolvedValue({ ok: true, result }) });
const refusing = (code, message = "refused") => ({ call: vi.fn().mockResolvedValue({ ok: false, code, message }) });

describe("the transport", () => {
  it("asks readPartBalance for ONE part and nothing else", async () => {
    const o = answering(SERVER);
    expect(await fetchPartBalance("P1", o)).toEqual(SERVER);
    expect(o.call.mock.calls[0].slice(0, 2)).toEqual(["readPartBalance", { partId: "P1" }]);
  });

  it("the scan lookup receives the projection with the warehouse key renamed -- and every figure untouched", async () => {
    const out = await fetchBalanceForScan({ partId: "P1" }, answering({ ...SERVER, onHand: UNKNOWN, available: UNKNOWN }));
    expect(out.errorStatus).toBeUndefined();
    expect(out.result.onHand).toEqual(UNKNOWN);
    expect(out.result.reserved).toEqual(K(3));
    expect(out.result.byLocation).toEqual([{ locationId: "wh-1", quantity: 13 }]);
    expect(balanceProjection(null).byLocation).toEqual([]);
  });

  it("a refusal is permission-denied; anything else is internal -- never an empty balance", async () => {
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("FORBIDDEN"))).errorStatus).toBe("permission-denied");
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("INTERNAL"))).errorStatus).toBe("internal");
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("NOT_FOUND"))).errorStatus).toBe("internal");
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("FORBIDDEN"))).result).toBeUndefined();
  });
});

function Probe({ partId, ready, fetchBalance }) {
  const s = usePartBalance(partId, { ready, fetchBalance });
  return <p data-testid="s">{s.status}{s.balance ? `:${s.balance.onHand.value}` : ""}</p>;
}
const stable = (fn) => fn; // a stable reference per test, so the effect does not re-run

describe("usePartBalance", () => {
  it("asks NOTHING where the environment has not switched the read on (OFF)", async () => {
    const fetchBalance = vi.fn();
    render(<Probe partId="P1" ready={false} fetchBalance={fetchBalance} />);
    expect(screen.getByTestId("s").textContent).toBe(BALANCE_STATUS.OFF);
    expect(fetchBalance).not.toHaveBeenCalled();
  });

  it("OFF without a Part, even when the read is on", () => {
    const fetchBalance = vi.fn();
    render(<Probe partId={null} ready fetchBalance={fetchBalance} />);
    expect(screen.getByTestId("s").textContent).toBe(BALANCE_STATUS.OFF);
    expect(fetchBalance).not.toHaveBeenCalled();
  });

  it("LOADING, then READY with the figures", async () => {
    const fetchBalance = stable(vi.fn().mockResolvedValue(SERVER));
    render(<Probe partId="P1" ready fetchBalance={fetchBalance} />);
    expect(screen.getByTestId("s").textContent).toBe(BALANCE_STATUS.LOADING);
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("READY:13"));
    expect(fetchBalance).toHaveBeenCalledWith("P1");
  });

  it("a server refusal is DENIED; any other failure is FAILED -- three different claims", async () => {
    const denied = stable(vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "FORBIDDEN" })));
    render(<Probe partId="P1" ready fetchBalance={denied} />);
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe(BALANCE_STATUS.DENIED));
    cleanup();
    const failed = stable(vi.fn().mockRejectedValue(new Error("down")));
    render(<Probe partId="P1" ready fetchBalance={failed} />);
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe(BALANCE_STATUS.FAILED));
  });
});

describe("the view", () => {
  it("UNKNOWN reads Unknown -- never 0 -- and a serial Part's quantities are counted by unit", () => {
    const v = partBalanceView({ onHand: UNKNOWN, reserved: K(0), available: UNKNOWN, byLocation: [] });
    expect(v.rows.map((r) => [r.label, r.value])).toEqual([["On Hand", "Unknown"], ["Reserved", "0"], ["Available", "Unknown"]]);
    const s = partBalanceView({ onHand: { state: "NOT_COUNTED_BY_QUANTITY", value: null }, reserved: { state: "NOT_COUNTED_BY_QUANTITY", value: null },
      available: { state: "NOT_COUNTED_BY_QUANTITY", value: null }, byLocation: [] });
    expect(s.rows.every((r) => r.value === "Counted by unit")).toBe(true);
  });

  it("locations are labelled through the resolver and keep the id when it will not resolve", () => {
    const v = partBalanceView(SERVER, (id) => (id === "wh-1" ? "Main warehouse" : id));
    expect(v.locations).toEqual([{ key: "wh-1", label: "Main warehouse", quantity: 13 }]);
    expect(partBalanceView({ ...SERVER, byLocation: [{ warehouseId: "wh-9", quantity: 2 }] }, (id) => id).locations[0].label).toBe("wh-9");
  });

  it("On Order: a known figure, a stated UNKNOWN, and the old absence where the read is off", () => {
    expect(partPurchasingSection(SERVER).rows[0]).toMatchObject({ key: "onOrder", value: "7", absence: null });
    expect(partPurchasingSection({ onOrder: K(0) }).rows[0].value).toBe("0");
    expect(partPurchasingSection({ onOrder: UNKNOWN }).rows[0]).toMatchObject({ value: null });
    expect(partPurchasingSection({ onOrder: UNKNOWN }).rows[0].absence).toMatch(/Unknown/);
    expect(partPurchasingSection().rows[0]).toMatchObject({ value: null, absence: "Not available in this environment" });
  });

  it("a Part with no ledger history gets the NEEDS_PLANNING recommendation, with no quantity or urgency invented", () => {
    const r = partNoHistoryRecommendation("P9");
    expect(r).toMatchObject({ partId: "P9", recommendationStatus: "NEEDS_PLANNING", urgency: null, recommendedOrderQty: 0 });
  });
});
