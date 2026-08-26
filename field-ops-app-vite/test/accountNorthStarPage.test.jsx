// THE ACCOUNT PAGE, AGAINST THE NORTH STAR GRAMMAR.
//
// Family 3. The derivation layer is asserted offline in test/accountNorthStar.test.mjs; this suite
// asserts the COMPOSITION, and two of its assertions are the whole reason the family was worth
// migrating:
//
//   * ATTENTION COMES BEFORE THE WORK (NS-P2). It used to render at the bottom of the secondary
//     column, below every related list — a reader reached it after everything it should have warned
//     them about. That is a DOM ORDER claim, so it is asserted as one.
//   * NO LIFECYCLE IS ASSERTED (ND-11). An Account's status is an editable field with no transition
//     command; four chevrons would claim a progression nothing enforces.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AccountDetail from "../src/modules/accounts/AccountDetail.jsx";
import { useAccount } from "../src/hooks/useAccount";

vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
// THE KEY IS `data`, NOT `locations`. Both hooks return { data, loading, error, retry } and the
// page destructures `data`. A mock that invents a friendlier key hands the component undefined and
// the render dies on .length — the same shape mistake family 1 made with useEquipmentDoc.
vi.mock("../src/hooks/useLocationsForAccount", () => ({
  useLocationsForAccount: () => ({ data: [], loading: false, error: null, retry: vi.fn() }),
}));
vi.mock("../src/hooks/useContactsForAccount", () => ({
  useContactsForAccount: () => ({ data: [], loading: false, error: null, retry: vi.fn() }),
}));
vi.mock("../src/hooks/useAccountAr", () => ({
  useAccountAr: () => ({ loading: false, errorStatus: null, result: null }),
}));
vi.mock("../src/hooks/useAccountAttentionWorkOrders", () => ({
  useAccountAttentionWorkOrders: () => ({ loading: false, error: null, workOrders: [], truncated: false }),
}));
// PARTIAL, via importOriginal: this module also exports useAccountWorkOrderTimeline, and a mock
// that omits an export the tree reaches for fails the whole render with a mock error rather than a
// real assertion — which is how a suite comes to prove nothing while looking red for the wrong
// reason.
vi.mock("../src/hooks/useAccountServiceActivity", async (importOriginal) => ({
  ...(await importOriginal()),
  useAccountWorkOrderCount: () => ({ count: null, loading: false, error: null }),
}));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ byUserId: new Map(), byEmployeeId: new Map(), loading: false, error: null }),
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, role: "admin" }) }));
vi.mock("../src/metadata/definitions/accountPageComponents.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAccountPageCapabilityDecisions: () => ({}) };
});

const DOC_ID = "acct_doc_secret";

function account(overrides = {}) {
  return {
    id: DOC_ID,
    name: "Harbor Grill Restaurant Group",
    status: "ACTIVE",
    relationshipTypes: ["CUSTOMER"],
    lineOfBusiness: ["TAYLOR"],
    customerNumber: "C-1042",
    tags: [],
    billingAddress: null,
    notes: null,
    ...overrides,
  };
}

function mount(overrides = {}) {
  useAccount.mockReturnValue({
    account: account(overrides),
    loading: false,
    error: null,
    retry: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={[`/customers/${DOC_ID}`]}>
      <Routes>
        <Route path="/customers/:accountId" element={<AccountDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Account — North Star composition", () => {
  // ─────────────── NS-P2: attention comes BEFORE the work

  it("the attention section renders BEFORE the record body, not after it", () => {
    const { container } = mount();
    const nodes = Array.from(container.querySelectorAll("*"));
    const attentionAt = nodes.findIndex((n) => /Account Attention/.test(n.textContent ?? "") && n.tagName === "H3");
    const bodyAt = nodes.findIndex((n) => n.classList?.contains("ns-record-body"));
    expect(attentionAt, "the attention section must be present").toBeGreaterThan(-1);
    expect(bodyAt, "the record body must be present").toBeGreaterThan(-1);
    expect(
      attentionAt,
      "attention renders after the work — this is the NS-P2 ordering defect the migration fixed",
    ).toBeLessThan(bodyAt);
  });

  it("the attention section renders exactly once", () => {
    // It was MOVED, not copied. Two mounts would double every account-scoped read behind it.
    const { container } = mount();
    const headings = Array.from(container.querySelectorAll("h3")).filter((h) => /Account Attention/.test(h.textContent));
    expect(headings).toHaveLength(1);
  });

  it("the record identity renders before the attention section", () => {
    const { container } = mount();
    const nodes = Array.from(container.querySelectorAll("*"));
    const identityAt = nodes.findIndex((n) => n.classList?.contains("ns-identity"));
    const attentionAt = nodes.findIndex((n) => /Account Attention/.test(n.textContent ?? "") && n.tagName === "H3");
    expect(identityAt).toBeGreaterThan(-1);
    expect(identityAt).toBeLessThan(attentionAt);
  });

  // ─────────────── ND-11: no lifecycle may be drawn

  it("NO lifecycle band is rendered, and the page says why in words", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-lifecycle"), "an Account has no lifecycle to draw").toBeNull();
    expect(container.textContent).toMatch(/status is a field someone sets, not a stage it moves through/i);
  });

  it("no status value is ever drawn as a reached or future stage", () => {
    for (const status of ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"]) {
      const { container, unmount } = mount({ status });
      expect(container.querySelectorAll(".ns-chip")).toHaveLength(0);
      unmount();
    }
  });

  // ─────────────── R02 / R03 / R04

  it("the account's NAME is the page's one h1", () => {
    const { container } = mount();
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("Harbor Grill Restaurant Group");
  });

  it("a nameless account states the absence and never falls back to the document id", () => {
    const { container } = mount({ name: null });
    const h1 = container.querySelector("h1");
    expect(h1.textContent).toMatch(/no name recorded/i);
    expect(container.textContent).not.toContain(DOC_ID);
  });

  it("no document id appears anywhere on the page", () => {
    for (const overrides of [{}, { name: null }, { status: "ARCHIVED" }, { relationshipTypes: [], lineOfBusiness: [] }]) {
      const { container, unmount } = mount(overrides);
      expect(container.textContent, `id leaked with ${JSON.stringify(overrides)}`).not.toContain(DOC_ID);
      unmount();
    }
  });

  it("the status renders as a sentence and its machine value never appears", () => {
    for (const [status, sentence] of [
      ["ACTIVE", /Active — trading normally/],
      ["INACTIVE", /Inactive — no longer trading/],
      ["PROSPECT", /Prospect — not yet a customer/],
      ["ARCHIVED", /Archived — closed/],
    ]) {
      const { container, unmount } = mount({ status });
      expect(container.querySelector(".ns-identity").textContent).toMatch(sentence);
      expect(container.textContent, `${status} leaked as an enum`).not.toContain(status);
      unmount();
    }
  });

  it("the status is stated ONCE — the header sentence, and not as a pill beside it", () => {
    const { container } = mount();
    expect(container.textContent.split("Active — trading normally").length - 1).toBe(1);
    // The old composition put a StatusPill row above the ContextBand. Nothing may restore it.
    expect(container.querySelector(".fo-pill-row")).toBeNull();
  });

  // ─────────────── classification

  it("the classification renders as words, and an account with none renders nothing", () => {
    const withBoth = mount({ relationshipTypes: ["CUSTOMER", "VENDOR"], lineOfBusiness: ["TAYLOR", "VENTANA"] });
    expect(screen.getByText("Customer · Vendor")).toBeTruthy();
    expect(screen.getByText("Taylor · Ventana")).toBeTruthy();
    withBoth.unmount();

    const withNone = mount({ relationshipTypes: [], lineOfBusiness: [] });
    expect(withNone.container.textContent).not.toMatch(/Vendor|Ventana/);
    // Never a silent default to the first value of either vocabulary.
    expect(withNone.container.querySelector(".ns-identity").textContent).not.toMatch(/\bTaylor\b/);
  });

  // ─────────────── the shell obligation

  it("the page composes ns-page and does not also host the workspace shell", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-page")).toBeTruthy();
    expect(container.querySelector(".ns-record-body")).toBeTruthy();
    expect(container.querySelector(".ns-rail")).toBeTruthy();
    // Two shells would double the chrome and give the page two competing h1 claims (ND-4).
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
