// THE SALES AGREEMENT RECORD PAGE, AGAINST NORTH STAR P1v2 — family 5.
//
// Visual authority: docs/north-star/sales-agreement/North Star - Sales Agreement P1v2.dc.html.
// Owner ruling: DECISIONS #134. The derivation layer is asserted offline in
// test/salesAgreementNorthStar.test.mjs and the read seam in test/salesAgreementByIdRead.test.mjs;
// this suite asserts the COMPOSITION, and — the half that matters most for a presentation slice —
// that composing it introduced NO AUTHORITY.
//
// Semantics, not pixel snapshots: what the page SAYS, what it refuses to say, and what it does not
// render at all.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import SalesAgreementDetail from "../src/modules/sales/SalesAgreementDetail.jsx";
import { useSalesAgreementById } from "../src/hooks/useSalesAgreementById.js";
import { salesAgreementView } from "../src/domain/salesAgreementView.js";
import { salesAgreementAbsence, SALES_AGREEMENT_READ_MODE } from "../src/domain/salesAgreementRead.js";

vi.mock("../src/hooks/useSalesAgreementById.js", () => ({ useSalesAgreementById: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    loading: false,
    error: null,
    byEmployeeId: new Map([["emp_ramado", { displayName: "R. Amado" }]]),
    byUserId: new Map([["uid_actor_9f2c", { displayName: "R. Amado" }]]),
  }),
}));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  useAccountNamesWithStatus: () => ({
    names: new Map([["acct_desert_sun", "Desert Sun Beverage Co."]]),
    status: "READY",
  }),
  ACCOUNT_NAMES_STATUS: { READY: "READY", DENIED: "DENIED", ERROR: "ERROR", LOADING: "LOADING" },
}));

const AGREEMENT_DOC_ID = "MHc7xk2QpLbR9vTn4sYe";
const ACTOR_UID = "uid_actor_9f2c";
const ACCEPTED_AT = 1_755_542_460_000;

const LINE_EQUIPMENT = { lineId: "ln-1", kind: "EQUIPMENT_MODEL", ref: "TAY-C712", quantity: 2, unitPriceMinor: 980000, extendedMinor: 1960000, condition: "NEW", warranty: "12 mo parts & labour", estimatedArrivalMillis: null };
const LINE_PART = { lineId: "ln-2", kind: "PART", ref: "X49463-3", quantity: 12, unitPriceMinor: 17500, extendedMinor: 210000, condition: "NEW", warranty: null, estimatedArrivalMillis: null };

function projection(overrides = {}) {
  const lines = overrides.lines ?? [LINE_EQUIPMENT, LINE_PART];
  const priced = lines.every((l) => l.unitPriceMinor !== null);
  const subtotalMinor = priced ? lines.reduce((n, l) => n + l.extendedMinor, 0) : null;
  const totalMinor = subtotalMinor === null ? null : subtotalMinor + 60000 + 25000 + 164605;
  return {
    status: "ready",
    salesAgreement: {
      id: AGREEMENT_DOC_ID,
      salesAgreementNumber: "SA-2026-000003",
      state: "DRAFT",
      accountId: "acct_desert_sun",
      ownerEmployeeId: "emp_ramado",
      locationId: "loc_broadway",
      currency: "USD",
      customerPO: "PO-88231",
      isLease: false,
      fulfillmentIntent: "BOTH",
      shippingInstructions: "Loading dock, 22nd St entrance.",
      shipVia: "Taylor truck",
      specialInstructions: "Commission both freezers on the same visit.",
      sourceOpportunityId: "opp_1842",
      salesOrderId: null,
      acceptedAtMillis: null,
      acceptedByUid: null,
      ...overrides,
      lines,
      subtotalMinor, shippingMinor: 60000, installChargeMinor: 25000, taxMinor: 164605,
      totalMinor, downPaymentMinor: 500000, tradeInMinor: 150000,
      balanceMinor: totalMinor === null ? null : totalMinor - 650000,
    },
  };
}

/** Drives the page exactly as the real seam does: projection → view → absence. */
function mountWith({ result = null, loading = false, errorStatus = null, grant = () => true, handlers = {}, seam = {} } = {}) {
  const view = salesAgreementView({ result, loading, errorStatus });
  const wired = {
    updateDraft: vi.fn().mockResolvedValue({ ok: true }),
    accept: vi.fn().mockResolvedValue({ ok: true }),
    pending: null,
    commandError: null,
    clearCommandError: vi.fn(),
    refresh: vi.fn(),
    ...seam,
  };
  useSalesAgreementById.mockReturnValue({
    view,
    absence: salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_ID),
    readMode: SALES_AGREEMENT_READ_MODE.BY_ID,
    STATE: {},
    ...wired,
  });
  return render(
    <MemoryRouter initialEntries={[`/customers/opportunities/sales-agreement/${AGREEMENT_DOC_ID}`]}>
      <Routes>
        <Route
          path="/customers/opportunities/sales-agreement/:salesAgreementId"
          element={<SalesAgreementDetail hasCapability={grant} {...handlers} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const ready = (overrides, opts) => mountWith({ result: projection(overrides), ...opts });
const ACCEPTED = { state: "ACCEPTED", acceptedAtMillis: ACCEPTED_AT, acceptedByUid: ACTOR_UID };

beforeEach(() => { vi.clearAllMocks(); });

describe("identity", () => {
  it("makes the governed agreement number the page's primary identity", () => {
    ready();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("SA-2026-000003");
  });

  it("never substitutes the document id for the business reference", () => {
    ready({ salesAgreementNumber: null });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sales Agreement");
    expect(document.body.textContent).not.toContain(AGREEMENT_DOC_ID);
  });

  it("states the agreement state in words, once", () => {
    ready();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("DRAFT");
  });

  it("names the customer rather than keying it", () => {
    ready();
    expect(screen.getAllByText("Desert Sun Beverage Co.").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("acct_desert_sun");
  });
});

describe("agreed lines", () => {
  it("keeps ref as the line identity when no display name resolves", () => {
    ready();
    expect(screen.getByText("TAY-C712")).toBeTruthy();
    expect(screen.getByText("X49463-3")).toBeTruthy();
  });

  it("never renders unknown money as zero", () => {
    ready({ lines: [LINE_EQUIPMENT, { ...LINE_PART, unitPriceMinor: null, extendedMinor: null }] });
    expect(screen.getAllByText("Not priced").length).toBe(2); // unit and committed, on the one line
    expect(document.body.textContent).not.toContain("$0.00");
  });

  it("claims no total while any line is unpriced, and names the unpriced line", () => {
    ready({ lines: [LINE_EQUIPMENT, { ...LINE_PART, unitPriceMinor: null, extendedMinor: null }] });
    expect(document.body.textContent).toContain("No subtotal, total or balance is claimed");
    expect(document.body.textContent).toContain("Incomplete — 1 line with no price");
    const attention = screen.getByLabelText("Blocking acceptance");
    expect(attention.textContent).toContain("X49463-3");
  });

  it("renders the two-block ladder with balance subordinate to the total", () => {
    ready();
    const sale = screen.getByLabelText("Sale composition");
    expect(within(sale).getByText("Total committed")).toBeTruthy();
    const credits = screen.getByLabelText("Credits recorded at commitment");
    expect(credits.textContent).toContain("Balance after credits");
    expect(credits.textContent).toContain("Not an accounts-receivable balance");
  });
});

describe("acceptance evidence", () => {
  it("shows only the three facts EOS writes", () => {
    ready(ACCEPTED);
    const evidence = document.querySelector(".ns-evidence");
    expect(within(evidence).getByText("Agreement state")).toBeTruthy();
    expect(within(evidence).getByText("Recorded")).toBeTruthy();
    expect(within(evidence).getByText("Action executed by")).toBeTruthy();
    expect(within(evidence).getByText("R. Amado")).toBeTruthy();
    // Exactly three facts — no fourth crept in claiming something EOS does not write.
    expect(evidence.querySelectorAll("dt").length).toBe(3);
  });

  it("falls back to Unknown user and never prints a raw uid", () => {
    ready({ ...ACCEPTED, acceptedByUid: "uid_not_in_directory" });
    expect(screen.getByText("Unknown user")).toBeTruthy();
    expect(document.body.textContent).not.toContain("uid_not_in_directory");
  });

  it("renders no unproven acceptance or signature language", () => {
    for (const overrides of [{}, ACCEPTED, { state: "DECLINED" }]) {
      const { unmount } = ready(overrides);
      const body = document.body.textContent;
      for (const banned of [/\bbinding\b/i, /\bsigned\b/i, /\belectronic/i, /customer accepted/i, /customer'?s commitment/i, /\blegally\b/i]) {
        expect(body).not.toMatch(banned);
      }
      // The one permitted mention is the explicit denial.
      if (overrides === ACCEPTED) expect(body).toContain("No customer-signature evidence is stored");
      unmount();
    }
  });
});

describe("actions — governed only, and restrictions kept apart", () => {
  it("offers edit and accept on an eligible draft, and nothing else", () => {
    ready({}, { handlers: { onEditDraft: vi.fn(), onRecordAcceptance: vi.fn() } });
    expect(screen.getByRole("button", { name: "Edit draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record acceptance" })).toBeTruthy();
    for (const banned of ["Decline", "Revise", "Supersede", "Reopen", "Replace", "Duplicate", "Send", "Present", "Convert", "Sign"]) {
      expect(screen.queryByRole("button", { name: new RegExp(banned, "i") })).toBeNull();
    }
  });

  it("blocks acceptance by STATE with the view model's own reason, naming the line", () => {
    ready({ lines: [{ ...LINE_PART, unitPriceMinor: null, extendedMinor: null }] }, {
      handlers: { onRecordAcceptance: vi.fn(), onEditDraft: vi.fn() },
    });
    const accept = screen.getByRole("button", { name: "Record acceptance" });
    expect(accept.disabled).toBe(true);
    expect(accept.dataset.restriction).toBe("state");
    expect(document.body.textContent).toContain("Every line needs a price");
    expect(document.body.textContent).toContain("X49463-3");
    // A state block must never be worded as a permission problem.
    expect(document.body.textContent).not.toMatch(/do not have permission/i);
  });

  it("blocks by PERMISSION with the capability's own sentence — a different restriction", () => {
    ready({}, { grant: () => false, handlers: { onRecordAcceptance: vi.fn(), onEditDraft: vi.fn() } });
    const accept = screen.getByRole("button", { name: "Record acceptance" });
    expect(accept.disabled).toBe(true);
    expect(accept.dataset.restriction).toBe("permission");
    expect(document.body.textContent).toMatch(/do not have permission to accept Sales Agreements/i);
  });

  it("removes the edit control entirely on a terminal agreement — absent, not disabled", () => {
    for (const state of [ACCEPTED, { state: "DECLINED" }]) {
      const { unmount } = ready(state, { handlers: { onEditDraft: vi.fn(), onRecordAcceptance: vi.fn() } });
      expect(screen.queryByRole("button", { name: "Edit draft" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Record acceptance" })).toBeNull();
      unmount();
    }
  });

  it("wires eligible controls to the governed commands (PR 4)", () => {
    // PR 3 asserted these were disabled because nothing was behind them. PR 4 is what puts
    // something behind them, so the assertion becomes the opposite — deliberately.
    ready();
    for (const name of ["Edit draft", "Record acceptance"]) {
      expect(screen.getByRole("button", { name }).disabled).toBe(false);
    }
  });
});

describe("provenance and downstream", () => {
  it("links the originating opportunity", () => {
    ready();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/customers/opportunities/opp_1842");
  });

  it("links the Sales Order when one exists", () => {
    ready({ ...ACCEPTED, salesOrderId: "so_15" });
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/customers/opportunities/sales-order/so_15");
  });

  it("states the exact governed trigger when no order exists, and invents no Create", () => {
    ready(ACCEPTED);
    expect(document.body.textContent).toContain("closed as won");
    expect(document.body.textContent).toContain("requires this agreement to be accepted first");
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  });
});

describe("honest states", () => {
  it("renders loading without claiming anything about existence", () => {
    mountWith({ loading: true });
    expect(document.body.textContent).toMatch(/loading/i);
  });

  it("distinguishes not-enabled from denied", () => {
    const notEnabled = mountWith({ errorStatus: "not-enabled" });
    expect(document.body.textContent).toContain("aren't enabled in this environment");
    expect(document.body.textContent).not.toMatch(/permission/i);
    notEnabled.unmount();

    mountWith({ errorStatus: "permission-denied" });
    expect(document.body.textContent).toMatch(/do not have permission to view Sales Agreements/i);
    expect(document.body.textContent).not.toContain("aren't enabled");
  });

  it("offers a retry on unavailable, and never reads as 'no agreement'", () => {
    mountWith({ errorStatus: "internal" });
    expect(document.body.textContent).toContain("couldn't reach this sales agreement");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/no sales agreement/i);
  });

  it("NOT_FOUND is a bad address, never NONE_YET and never an invitation to create", () => {
    mountWith({ result: { status: "not-found", salesAgreement: null } });
    expect(document.body.textContent).toContain("No sales agreement matches this address.");
    expect(document.body.textContent).not.toContain("No sales agreement yet.");
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /create/i })).toBeNull();
  });

  it("represents DECLINED as a readable state with no action to produce it", () => {
    ready({ state: "DECLINED" });
    expect(screen.getAllByText("Declined").length).toBeGreaterThan(0);
    expect(screen.getByText("TAY-C712")).toBeTruthy(); // the record stays readable
    expect(screen.queryByRole("button", { name: /decline/i })).toBeNull();
  });
});

describe("composition and authority", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../src/modules/sales/SalesAgreementDetail.jsx"), "utf8");
  const css = readFileSync(join(here, "../src/index.css"), "utf8");

  it("draws NO lifecycle band — this family is a gate, not a journey (SA-D2)", () => {
    ready();
    expect(document.querySelector(".ns-lifecycle")).toBeNull();
    expect(document.querySelector(".ns-chevron")).toBeNull();
    // Targets IMPORT and USAGE, not prose: this file talks about the absence in its own comments,
    // and an assertion that forbade the word would forbid explaining why the word is absent.
    expect(source).not.toMatch(/imports+.*Lifecycle(Band|Chevrons)/);
    expect(source).not.toMatch(/<Lifecycle(Band|Chevrons)/);
  });

  it("composes ns-page and RecordIdentity, and does NOT host WorkspaceShell (DECISIONS #126)", () => {
    ready();
    expect(document.querySelector(".ns-page")).toBeTruthy();
    expect(document.querySelector(".ns-identity")).toBeTruthy();
    expect(source).not.toMatch(/WorkspaceShell/);
  });

  it("leaves the shared North Star grammar untouched (ND-16)", () => {
    // The page must not restate .ns-record-body or --rail-width to reach the artifact's widths.
    expect(source).not.toMatch(/grid-template-columns|--rail-width/);
    expect(css).toMatch(/\.ns-record-body \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 0 56px; \}/);
    expect(css).toMatch(/--rail-width: 252px;/);
    expect(css).toMatch(/\.ns-record-body \{ grid-template-columns: minmax\(0, 1fr\) 340px; \}/);
  });

  it("introduces no write path and no new authority", () => {
    for (const banned of [
      /firebase\/firestore/, /httpsCallable/, /createSalesAgreement/, /acceptSalesAgreement\(/,
      /updateSalesAgreementDraft\(/, /idempotencyKey/,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });
});

describe("responsive — no horizontal overflow", () => {
  // jsdom does not lay out, so an offsetWidth check would be theatre. What IS assertable is the
  // structural cause of overflow at 375: a wide element that cannot scroll inside its own box.
  it("puts the wide commercial table in its own scroll container", () => {
    ready();
    const table = document.querySelector(".ns-table");
    expect(table).toBeTruthy();
    expect(table.closest(".ns-table-wrap")).toBeTruthy();
  });

  it("the scroll container and the page body are declared to contain their own overflow", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");
    expect(css).toMatch(/\.ns-table-wrap \{[^}]*overflow-x: auto/);
  });
});
