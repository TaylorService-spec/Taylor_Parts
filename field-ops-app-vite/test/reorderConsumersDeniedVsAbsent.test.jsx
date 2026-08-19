// H14 (reorder pair) -- AssociateRequestPanel.jsx's OrderedCard and
// TerminalCard (and PartDetail.jsx's ReorderRequestOrdered/ReorderRequestVoided,
// which copy the same pattern) used to render "Purchase Order details
// unavailable." for BOTH a denied read and a genuinely not-yet-recorded PO --
// see hooks/useReorderPurchaseOrders.js's and
// hooks/useReorderPurchaseOrderVoids.js's own H14 header for the hook-side
// half of this fix (test/reorderPurchaseOrderReadErrorContract.test.jsx pins
// that contract). This file pins the CONSUMER side: given the hook's new
// `error` field, the card must render a visible failure for a denied read
// and keep the honest "unavailable" copy only for a genuine "not_found".
//
// usePurchaseOrderForReorderRequest/useReorderPurchaseOrderVoid and
// useReorderRequestById are mocked (no Firebase, no network) so each state
// can be driven directly through the exported AssignedRequestDetail.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/hooks/useReorderRequests.js", () => ({ useReorderRequestById: vi.fn() }));
vi.mock("../src/hooks/useReorderPurchaseOrders.js", () => ({ usePurchaseOrderForReorderRequest: vi.fn() }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids.js", () => ({ useReorderPurchaseOrderVoid: vi.fn() }));

import { useReorderRequestById } from "../src/hooks/useReorderRequests.js";
import { usePurchaseOrderForReorderRequest } from "../src/hooks/useReorderPurchaseOrders.js";
import { useReorderPurchaseOrderVoid } from "../src/hooks/useReorderPurchaseOrderVoids.js";
import { AssignedRequestDetail } from "../src/shared/reorder/AssociateRequestPanel.jsx";
import { REORDER_REQUEST_STATUS } from "../src/domain/constants.js";

const resolveName = () => "Widget A";

function renderOrderedCard() {
  useReorderRequestById.mockReturnValue({
    data: { id: "req-1", status: REORDER_REQUEST_STATUS.ORDERED, partId: "P1" },
    loading: false,
    error: null,
  });
  return render(<AssignedRequestDetail requestId="req-1" resolveName={resolveName} onClose={() => {}} />);
}

function renderTerminalVoidedCard() {
  useReorderRequestById.mockReturnValue({
    data: { id: "req-1", status: REORDER_REQUEST_STATUS.VOIDED, partId: "P1", voidReason: "Duplicate" },
    loading: false,
    error: null,
  });
  return render(<AssignedRequestDetail requestId="req-1" resolveName={resolveName} onClose={() => {}} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderedCard -- denied vs absent Purchase Order read (H14)", () => {
  it("a denied read renders a visible failure, not the 'details unavailable' empty copy", () => {
    usePurchaseOrderForReorderRequest.mockReturnValue({ data: null, loading: false, error: "permission-denied" });
    renderOrderedCard();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/purchase order details unavailable/i)).toBeNull();
  });

  it("a genuinely absent PO ('not_found') still renders the honest 'unavailable' copy, not an alert", () => {
    usePurchaseOrderForReorderRequest.mockReturnValue({ data: null, loading: false, error: "not_found" });
    renderOrderedCard();
    expect(screen.getByText(/purchase order details unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a resolved PO renders its data, not a failure", () => {
    usePurchaseOrderForReorderRequest.mockReturnValue({
      data: { supplierName: "Acme", externalPoNumber: "PO-1", orderedQuantity: 5, orderedDate: "2026-01-01" },
      loading: false,
      error: null,
    });
    renderOrderedCard();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TerminalCard (Voided) -- denied vs absent void record read (H14)", () => {
  it("a denied void-record read with no fallback reason renders a visible failure", () => {
    useReorderPurchaseOrderVoid.mockReturnValue({ data: null, loading: false, error: "permission-denied" });
    useReorderRequestById.mockReturnValue({
      data: { id: "req-1", status: REORDER_REQUEST_STATUS.VOIDED, partId: "P1" }, // no voidReason fallback
      loading: false,
      error: null,
    });
    render(<AssignedRequestDetail requestId="req-1" resolveName={resolveName} onClose={() => {}} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("not_found (genuinely no void record) renders the em-dash fallback, not an alert", () => {
    useReorderPurchaseOrderVoid.mockReturnValue({ data: null, loading: false, error: "not_found" });
    renderTerminalVoidedCard();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
