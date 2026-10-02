// TAX EVIDENCE ON THE AGREEMENT WORKFLOW (DECISIONS #197; Controller FINANCE ACTIVATION 2 E–G, tests 5–11).
//
// The smallest control: "Tax not yet determined" or "Tax determined" with an amount (zero allowed, and clearly a
// determined zero). The server's reset to not-determined is reflected; an Agreement recorded before evidence existed reads
// the neutral "Tax needs confirmation" -- never "No tax" / "Tax exempt"; no status code or id reaches the screen; and a
// bare tax amount is never sent (the server would read it as an un-evidenced change).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SalesAgreementPanel from "../src/modules/sales/SalesAgreementPanel.jsx";
import SalesAgreementDetail from "../src/modules/sales/SalesAgreementDetail.jsx";
import { useSalesAgreementById } from "../src/hooks/useSalesAgreementById.js";
import { salesAgreementView } from "../src/domain/salesAgreementView.js";
import { toSalesAgreementProjection } from "../src/services/commercialEosAdapters.js";
import { taxEvidenceDisplay, taxEvidencePatch, TAX_CHOICE } from "../src/domain/taxEvidenceView.js";
import { toMinor } from "../src/modules/sales/salesAgreementLines.jsx";

vi.mock("../src/hooks/useSalesAgreementById.js", () => ({ useSalesAgreementById: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ loading: false, error: null, byEmployeeId: new Map(), byUserId: new Map() }),
}));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  useAccountNamesWithStatus: () => ({ names: new Map([["acct_1", "Desert Sun Beverage Co."]]), status: "READY" }),
  ACCOUNT_NAMES_STATUS: { READY: "READY", DENIED: "DENIED", ERROR: "ERROR", LOADING: "LOADING" },
}));

const LINE = { lineId: "ln-1", kind: "PART", ref: "X49463-3", quantity: 1, unitPriceMinor: 25000, extendedMinor: 25000, condition: "NEW", warranty: null, estimatedArrivalMillis: null };
// Server vocabulary that must never be drawn.
const FORBIDDEN = [/NOT_DETERMINED/, /LEGACY_UNVERIFIED/, /\bDETERMINED\b/, /No tax\b/i, /Tax exempt/i, /sag_[0-9a-f]/];

function viewOf({ status, taxMinor = 0, state = "DRAFT" }) {
  return salesAgreementView({
    loading: false, errorStatus: null,
    result: {
      status: "ready",
      salesAgreement: {
        id: "sag_0f3c", salesAgreementNumber: "SA-2026-000041", state, accountId: "acct_1", ownerEmployeeId: "emp_1",
        locationId: null, currency: "USD", customerPO: null, isLease: false, fulfillmentIntent: null,
        shippingInstructions: null, shipVia: null, specialInstructions: null, lines: [LINE],
        subtotalMinor: 25000, shippingMinor: 0, installChargeMinor: 0, taxMinor, totalMinor: 25000 + taxMinor,
        downPaymentMinor: 0, tradeInMinor: 0, balanceMinor: 25000 + taxMinor,
        taxEvidenceStatus: status, taxEvidenceAmountMinor: status === "DETERMINED" ? taxMinor : null,
        sourceOpportunityId: "opp_1", salesOrderId: null, acceptedAtMillis: null, acceptedByUid: null,
      },
    },
  });
}

function mountPanel(view, updateDraft = vi.fn().mockResolvedValue({ ok: true })) {
  const agreement = { view, create: vi.fn(), updateDraft, accept: vi.fn(), pending: null, commandError: null };
  const utils = render(<MemoryRouter><SalesAgreementPanel agreement={agreement} hasCapability={() => true} /></MemoryRouter>);
  return { ...utils, updateDraft };
}
const openTerms = () => fireEvent.click(screen.getByRole("button", { name: "Edit terms" }));
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save terms" }));
const noServerVocabulary = (container) => { for (const re of FORBIDDEN) expect(container.textContent).not.toMatch(re); };

beforeEach(() => { vi.clearAllMocks(); });

describe("5 — the two human choices", () => {
  it("offers exactly 'Tax not yet determined' and 'Tax determined', with an amount only when determined", () => {
    const { container } = mountPanel(viewOf({ status: "NOT_DETERMINED" }));
    openTerms();
    const fs = container.querySelector("fieldset.fo-agreement-tax-control");
    const radios = within(fs).getAllByRole("radio");
    expect(radios.map((r) => r.parentElement.textContent.trim())).toEqual(["Tax not yet determined", "Tax determined"]);
    expect(within(fs).queryByLabelText("Tax amount")).toBeNull();
    fireEvent.click(radios[1]);
    expect(within(fs).getByLabelText("Tax amount")).toBeTruthy();
    // The old bare "Tax" charge box is gone.
    expect(container.querySelectorAll("input:not([type=radio]):not([type=checkbox])").length).toBeGreaterThan(0);
    expect([...container.querySelectorAll("label")].some((l) => l.textContent.trim() === "Tax" && l.querySelector("input"))).toBe(false);
  });
});

describe("6 — a determined amount sends governed evidence, never a bare tax amount", () => {
  it("submits taxEvidence DETERMINED in minor units and no taxMinor", async () => {
    const { updateDraft } = mountPanel(viewOf({ status: "NOT_DETERMINED" }));
    openTerms();
    fireEvent.click(screen.getByRole("radio", { name: "Tax determined" }));
    fireEvent.change(screen.getByLabelText("Tax amount"), { target: { value: "18.50" } });
    save();
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    const patch = updateDraft.mock.calls[0][1];
    expect(patch.taxEvidence).toEqual({ status: "DETERMINED", amountMinor: 1850, currency: "USD" });
    expect("taxMinor" in patch).toBe(false);
  });
  it("an empty amount is NOT zero: it is refused locally and nothing is sent", () => {
    const { updateDraft } = mountPanel(viewOf({ status: "NOT_DETERMINED" }));
    openTerms();
    fireEvent.click(screen.getByRole("radio", { name: "Tax determined" }));
    save();
    expect(screen.getByRole("alert").textContent).toMatch(/Enter 0 if none is due/);
    expect(updateDraft).not.toHaveBeenCalled();
  });
});

describe("7 — zero is allowed and reads as a determined zero", () => {
  it("submits 0 as DETERMINED and the saved zero reads as determined, not as no tax", async () => {
    const { updateDraft, unmount } = mountPanel(viewOf({ status: "NOT_DETERMINED" }));
    openTerms();
    fireEvent.click(screen.getByRole("radio", { name: "Tax determined" }));
    fireEvent.change(screen.getByLabelText("Tax amount"), { target: { value: "0" } });
    save();
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    expect(updateDraft.mock.calls[0][1].taxEvidence).toEqual({ status: "DETERMINED", amountMinor: 0, currency: "USD" });
    unmount();
    const { container } = mountPanel(viewOf({ status: "DETERMINED", taxMinor: 0 }));
    const summary = container.querySelector("[data-tax-evidence]");
    expect(summary.dataset.taxEvidence).toBe("determined");
    expect(summary.textContent).toMatch(/Tax determined/);
    expect(summary.textContent).toMatch(/\$0\.00/);
    expect(summary.textContent).toMatch(/Zero tax was determined/);
    noServerVocabulary(container);
  });
  it("the North Star ladder draws a determined zero instead of omitting the row", () => {
    useSalesAgreementById.mockReturnValue({ view: viewOf({ status: "DETERMINED", taxMinor: 0 }), absence: null, readMode: "BY_ID", STATE: {},
      updateDraft: vi.fn(), accept: vi.fn(), pending: null, commandError: null, clearCommandError: vi.fn(), refresh: vi.fn() });
    const { container } = render(
      <MemoryRouter initialEntries={["/a/sag_0f3c"]}>
        <Routes><Route path="/a/:salesAgreementId" element={<SalesAgreementDetail hasCapability={() => true} />} /></Routes>
      </MemoryRouter>,
    );
    const row = container.querySelector(".ns-ladder [data-tax-evidence]");
    expect(row.dataset.taxEvidence).toBe("determined");
    expect(row.textContent).toMatch(/Tax\$0\.00/);
    noServerVocabulary(container);
  });
});

describe("8 — choosing 'not yet determined' sends that, and nothing when unchanged", () => {
  it("DETERMINED -> not yet determined sends { status: NOT_DETERMINED }", async () => {
    const { updateDraft } = mountPanel(viewOf({ status: "DETERMINED", taxMinor: 1850 }));
    openTerms();
    expect(screen.getByRole("radio", { name: "Tax determined" }).checked).toBe(true);
    expect(screen.getByLabelText("Tax amount").value).toBe("18.50");
    fireEvent.click(screen.getByRole("radio", { name: "Tax not yet determined" }));
    save();
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    expect(updateDraft.mock.calls[0][1].taxEvidence).toEqual({ status: "NOT_DETERMINED" });
  });
  it("re-saving unrelated terms does not re-record an unchanged determination", async () => {
    const { updateDraft } = mountPanel(viewOf({ status: "DETERMINED", taxMinor: 1850 }));
    openTerms();
    save();
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    const patch = updateDraft.mock.calls[0][1];
    expect("taxEvidence" in patch).toBe(false);
    expect("taxMinor" in patch).toBe(false);
  });
});

describe("9 — the server's reset to not-determined is reflected", () => {
  it("a server answer of NOT_DETERMINED reads 'Tax not yet determined' with no amount, even though the column holds one", () => {
    // The server resets evidence when a bare amount changes; the stored charge may still be non-zero.
    const reset = toSalesAgreementProjection({
      id: "sag_0f3c", salesAgreementNumber: "SA-2026-000041", state: "DRAFT", currency: "USD", lines: [],
      totals: { subtotalMinor: 25000, shippingMinor: 0, installChargeMinor: 0, taxMinor: 1850, totalMinor: 26850, downPaymentMinor: 0, tradeInMinor: 0, balanceMinor: 26850 },
      taxEvidence: { status: "NOT_DETERMINED", amountMinor: null },
    });
    const view = salesAgreementView({ result: { status: "ready", salesAgreement: reset }, loading: false, errorStatus: null });
    expect(view.taxMinor).toBeNull();
    const shown = taxEvidenceDisplay(view);
    expect(shown).toMatchObject({ kind: "notDetermined", label: "Tax not yet determined", amountText: null, isDetermined: false });
    const { container } = mountPanel(view);
    expect(container.querySelector("[data-tax-evidence]").textContent).toMatch(/^Tax not yet determined/);
    expect(container.querySelector("[data-tax-evidence]").textContent).not.toMatch(/18\.50/);
    noServerVocabulary(container);
  });
});

describe("10 — legacy reads neutral 'Tax needs confirmation'", () => {
  it("LEGACY_UNVERIFIED (and a backend that sends no evidence) never reads as No tax / Tax exempt / $0.00", () => {
    for (const status of ["LEGACY_UNVERIFIED", null]) {
      const { container, unmount } = mountPanel(viewOf({ status, taxMinor: 0 }));
      const summary = container.querySelector("[data-tax-evidence]");
      expect(summary.dataset.taxEvidence).toBe("needsConfirmation");
      expect(summary.textContent).toMatch(/^Tax needs confirmation/);
      expect(summary.textContent).not.toMatch(/\$0\.00|0\.00/);
      noServerVocabulary(container);
      unmount();
    }
  });
  it("a legacy Agreement starts with NO choice, and saving other terms leaves it exactly as recorded", async () => {
    const { updateDraft } = mountPanel(viewOf({ status: "LEGACY_UNVERIFIED" }));
    openTerms();
    for (const r of screen.getAllByRole("radio")) expect(r.checked).toBe(false);
    save();
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    const patch = updateDraft.mock.calls[0][1];
    expect("taxEvidence" in patch).toBe(false);
    expect("taxMinor" in patch).toBe(false);
  });
});

describe("11 — no server vocabulary or ids, and the domain contract", () => {
  it("every rendered state is free of status codes and record ids", () => {
    for (const v of [viewOf({ status: "NOT_DETERMINED" }), viewOf({ status: "DETERMINED", taxMinor: 1850 }), viewOf({ status: "LEGACY_UNVERIFIED" })]) {
      const { container, unmount } = mountPanel(v);
      openTerms();
      noServerVocabulary(container);
      unmount();
    }
  });
  it("taxEvidencePatch refuses malformed amounts and keeps the currency the Agreement's own", () => {
    const v = viewOf({ status: "NOT_DETERMINED" });
    expect(taxEvidencePatch(v, { choice: TAX_CHOICE.DETERMINED, amount: "-1" }, toMinor).error).toBeTruthy();
    expect(taxEvidencePatch(v, { choice: TAX_CHOICE.DETERMINED, amount: "12.345" }, toMinor).error).toBeTruthy();
    expect(taxEvidencePatch(v, { choice: TAX_CHOICE.DETERMINED, amount: "12.3" }, toMinor).taxEvidence).toEqual({ status: "DETERMINED", amountMinor: 1230, currency: "USD" });
    expect(taxEvidencePatch(v, { choice: null, amount: "" }, toMinor)).toEqual({});
  });
});
