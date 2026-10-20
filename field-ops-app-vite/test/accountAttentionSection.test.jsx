// Render gate for AccountAttentionSection (vitest + jsdom), mirroring workOrderAttentionPanel's
// pattern: mocks the two underlying reads (useAccountAr, useAccountAttentionWorkOrders) at their
// hook boundary and proves the projection -> component wiring through the REAL
// domain/accountAttentionProjection.js, not a re-implemented stub.
//
// RECONCILED TO ACCOUNT NORTH STAR P1. The assertions below are the same RULES this suite always
// defended -- two sections never merged, per-source honest notes, denied never collapsed into a
// fabricated zero, a truncated read never reported as a confident list -- restated against the
// approved composition, which changed three things about how they are drawn:
//
//   * A CONFIRMED-HEALTHY, EMPTY account renders NOTHING (design decision A-D1). The old
//     "Nothing needs attention on this account right now." receipt is gone, and its absence is now
//     itself asserted -- silence is the healthy state, and a green all-clear would be one more
//     thing to read on every healthy customer.
//   * The row's DEEP LINK is a named resolution action ("Review" / "Open"), not the reference
//     itself. The link target is unchanged and is still asserted exactly.
//   * The INTELLIGENCE line renders inside the surface, beneath the facts. It is explanation only
//     and stays silent whenever a source is degraded -- both are asserted here, because a
//     confident explanation over an incomplete list is the precise failure the fail-closed
//     contract in domain/accountIntelligence.js exists to prevent.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useAccountAr.js", () => ({ useAccountAr: vi.fn() }));
vi.mock("../src/hooks/useAccountAttentionWorkOrders.js", () => ({ useAccountAttentionWorkOrders: vi.fn() }));

import { useAccountAr } from "../src/hooks/useAccountAr.js";
import { useAccountAttentionWorkOrders } from "../src/hooks/useAccountAttentionWorkOrders.js";
import { accountArFromBalanceSummary, accountArFromObligations } from "../src/domain/accountReceivablesEos.js";
import AccountArSection from "../src/modules/accounts/AccountArSection.jsx";
import AccountAttentionSection from "../src/modules/accounts/AccountAttentionSection.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DAY = 24 * 60 * 60 * 1000;
const TODAY_START = new Date(2026, 5, 10, 0, 0, 0, 0).getTime();

function mockReads({ ar, wo }) {
  useAccountAr.mockReturnValue(ar);
  useAccountAttentionWorkOrders.mockReturnValue(wo);
}

const renderSection = (props) => render(<MemoryRouter><AccountAttentionSection {...props} /></MemoryRouter>);

const HEALTHY_AR = { loading: false, errorStatus: null, result: { status: "ready", invoices: [], summary: {} } };
const HEALTHY_WO = { loading: false, error: false, workOrders: [], truncated: false };

const OVERDUE_AR = (daysOverdue = 12, outstandingMinor = 50000) => ({
  loading: false,
  errorStatus: null,
  result: {
    status: "ready",
    invoices: [
      { invoiceId: "inv-1", invoiceNumber: "INV-1001", arPosition: "OVERDUE", outstandingMinor, currency: "USD", daysOverdue },
    ],
    summary: { count: 1, openCount: 1, overdueCount: 1, outstandingByCurrency: { USD: outstandingMinor } },
  },
});

const PAST_DUE_WO = {
  loading: false,
  error: false,
  workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }],
  truncated: false,
};

describe("AccountAttentionSection -- Account Attention projection wiring", () => {
  it("a fully-healthy account renders NOTHING -- silence is the healthy state (A-D1)", () => {
    mockReads({ ar: HEALTHY_AR, wo: HEALTHY_WO });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(container.querySelector(".ns-attn"), "the whole surface is absent when nothing needs attention").toBeNull();
    // No green all-clear, no receipt, no empty shell.
    expect(container.textContent).toBe("");
  });

  it("renders an overdue invoice under 'Accounts Receivable' with a correct deep link and its own fields, never a WO field", () => {
    mockReads({ ar: OVERDUE_AR(), wo: HEALTHY_WO });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Accounts Receivable")).toBeTruthy();
    expect(screen.getByText("INV-1001")).toBeTruthy();
    // The governed AR fields, and only those -- never a work-order field on an AR row.
    expect(screen.getByText(/\$500\.00/)).toBeTruthy();
    expect(screen.getByText(/12d overdue/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /Review/ });
    expect(link.getAttribute("href")).toBe("/customers/acct-1#account-ar-section");
  });

  it("words an EOS overdue record as a Receivable, not an Invoice, and states no day count (F7c, DECISIONS #245)", () => {
    mockReads({
      ar: {
        loading: false,
        errorStatus: null,
        result: accountArFromObligations([{
          items: [{ id: "ob-7", operatingCompanyId: "taylor", kind: "RECEIVABLE", currency: "USD", status: "OPEN", dueOn: "2026-05-01", overdue: true,
            originatedMinor: "50000", settledMinor: "0", outstandingMinor: "50000", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-1", name: "Harbor" } }],
          truncated: false,
        }]),
      },
      wo: HEALTHY_WO,
    });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(screen.getByText("ob-7")).toBeTruthy();
    expect(container.textContent).toMatch(/Receivable\s*ob-7/);
    expect(container.textContent).not.toMatch(/Invoice/);
    expect(container.textContent).not.toMatch(/\d+d overdue/);
    expect(screen.getByRole("link", { name: /Review/ }).getAttribute("href")).toBe("/customers/acct-1#account-ar-section");
  });

  it("renders a past-due work order under 'Past Due' with the canonical WO deep link, kept in a section distinct from AR", () => {
    mockReads({ ar: HEALTHY_AR, wo: PAST_DUE_WO });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Past Due")).toBeTruthy();
    expect(screen.getByText("WO-1001")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open/ });
    expect(link.getAttribute("href")).toBe("/service/work-orders/WO-1");
    // AR and WO sections never interleave -- the AR heading is absent when AR is healthy-empty.
    expect(screen.queryByText("Accounts Receivable")).toBeNull();
  });

  it("both sources firing at once render as two DISTINCT sections, never merged/ranked together", () => {
    mockReads({ ar: OVERDUE_AR(3, 1000), wo: PAST_DUE_WO });
    const { container } = renderSection({ accountId: "acct-1" });
    const headings = Array.from(container.querySelectorAll(".ns-attn__section-title")).map((el) => el.textContent);
    expect(headings).toEqual(["Accounts Receivable", "Past Due"]); // fixed, distinct order
    // Two lists, not one -- a merged/ranked list would be a single <ul>.
    expect(container.querySelectorAll(".ns-attn__list")).toHaveLength(2);
  });

  it("a denied AR read renders an honest denied note, and never a fabricated zero for that source", () => {
    mockReads({ ar: { loading: false, errorStatus: "denied", result: null }, wo: HEALTHY_WO });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Accounts Receivable: not available to you.")).toBeTruthy();
    // The surface stays -- a source that could NOT be confirmed never earns the silence a
    // confirmed-healthy read earns.
    expect(container.querySelector(".ns-attn")).toBeTruthy();
  });

  it("a failed WO read renders an honest unavailable note, distinct from a confirmed-healthy empty state", () => {
    mockReads({ ar: HEALTHY_AR, wo: { loading: false, error: true, workOrders: null, truncated: false } });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(screen.getByText(/Work order attention: couldn/)).toBeTruthy();
    expect(container.querySelector(".ns-attn")).toBeTruthy();
  });

  it("a REFUSED WO read says 'not available to you' -- never 'couldn't be read, try again later'", () => {
    mockReads({ ar: HEALTHY_AR, wo: { loading: false, error: false, denied: true, workOrders: null, truncated: false } });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Work order attention: not available to you.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/couldn/i);
    expect(container.textContent).not.toMatch(/Try again later/);
    // A source that could NOT be confirmed never earns the silence a confirmed-healthy read earns.
    expect(container.querySelector(".ns-attn")).toBeTruthy();
    // ...and it never speaks an explanation over a source it was refused.
    expect(container.querySelector(".ns-attn__intel")).toBeNull();
  });

  it("a genuinely FAILED WO read still says 'couldn't be read. Try again later.'", () => {
    mockReads({ ar: HEALTHY_AR, wo: { loading: false, error: true, denied: false, workOrders: null, truncated: false } });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Work order attention: couldn’t be read. Try again later.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/not available to you/);
  });

  it("a refused WO read and a denied AR read are stated independently, each in its own words", () => {
    mockReads({
      ar: { loading: false, errorStatus: "unavailable", result: null },
      wo: { loading: false, error: false, denied: true, workOrders: null, truncated: false },
    });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Accounts Receivable: couldn’t be read. Try again later.")).toBeTruthy();
    expect(screen.getByText("Work order attention: not available to you.")).toBeTruthy();
  });

  it("a truncated (possibly-incomplete) WO read degrades to the unavailable note rather than an under-reported list", () => {
    mockReads({ ar: HEALTHY_AR, wo: { loading: false, error: false, workOrders: [], truncated: true } });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText(/Work order attention: couldn/)).toBeTruthy();
  });

  // ─────────────── the intelligence line: explanation only, and silent when it cannot be sure

  it("the intelligence line explains the governed facts, offers no action, and sits BELOW them", () => {
    mockReads({ ar: OVERDUE_AR(3, 1000), wo: PAST_DUE_WO });
    const { container } = renderSection({ accountId: "acct-1" });
    const intel = container.querySelector(".ns-attn__intel");
    expect(intel).toBeTruthy();
    expect(intel.textContent).toMatch(/both overdue receivables and past-due service work/);
    // It explains; it never proposes. No button, no link, no recommendation slot inside it.
    expect(intel.querySelectorAll("button, a")).toHaveLength(0);
    expect(intel.textContent).toMatch(/Explanation only/);
    // DOM order: the facts it explains come first.
    const nodes = Array.from(container.querySelectorAll("*"));
    expect(nodes.indexOf(container.querySelector(".ns-attn__sections")))
      .toBeLessThan(nodes.indexOf(intel));
  });

  it("the intelligence line is SILENT whenever a source is degraded, even though rows still render", () => {
    // AR denied, a real past-due WO present: the rows are true, but the story is not complete.
    mockReads({ ar: { loading: false, errorStatus: "denied", result: null }, wo: PAST_DUE_WO });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(screen.getByText("WO-1001"), "the confirmed source still renders its rows").toBeTruthy();
    expect(container.querySelector(".ns-attn__intel"), "a partial story is never told confidently").toBeNull();
  });

  it("the intelligence line is SILENT on a truncated work-order read", () => {
    mockReads({ ar: OVERDUE_AR(), wo: { loading: false, error: false, workOrders: [], truncated: true } });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(container.querySelector(".ns-attn__intel")).toBeNull();
  });

  it("never renders a raw Firebase UID anywhere on the page", () => {
    mockReads({ ar: OVERDUE_AR(3, 1000), wo: PAST_DUE_WO });
    renderSection({ accountId: "acct-1" });
    // A raw Firebase auth uid is a long opaque alphanumeric token -- none of this component's
    // rendered text is ever a bare id string (every id-shaped value shown is a human label:
    // invoice/WO number).
    expect(screen.queryByText(/^[A-Za-z0-9]{20,}$/)).toBeNull();
  });
});

// ── A6 (Owner decision, 2026-10-19): the customer-balance SUMMARY reader ─────────────────────────────────────────
// A role with finance.accountBalance.read and no Finance workspace is shown totals per company and currency, never rows. Attention therefore has no
// per-receivable item for it, and must say "not available", never the healthy "nothing overdue". The summary table is drawn by AccountArSection.
const A6_ANSWER = (summaries, extra = {}) => ({
  status: "READY", asOf: "2026-10-19T12:00:00.000Z", restricted: false, ...extra,
  summaries: summaries.map(([operatingCompanyId, currency, openReceivableCount, outstandingMinor, overdueCount, overdueMinor]) =>
    ({ operatingCompanyId, currency, openReceivableCount, outstandingMinor, overdueCount, overdueMinor })),
});
const A6_TAYLOR = ["taylor", "USD", 3, "64000", 1, "40000"];
const A6_VENTANA = ["ventana", "USD", 1, "11000", 1, "11000"];

describe("A6: a balance-summary reader", () => {
  it("Attention shows the AR source as not available to it, with no receivable item and no overdue claim", () => {
    mockReads({ ar: { loading: false, errorStatus: null, result: accountArFromBalanceSummary(A6_ANSWER([A6_TAYLOR])) }, wo: HEALTHY_WO });
    const { container } = renderSection({ accountId: "acct-1" });
    expect(container.textContent).toMatch(/Accounts Receivable: not available to you/);
    expect(container.textContent).not.toMatch(/overdue/i);
  });

  it("AccountArSection shows one line per company and currency, says it is a summary, and offers no receivable rows", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: null, result: accountArFromBalanceSummary(A6_ANSWER([A6_TAYLOR, A6_VENTANA])) });
    const { container } = render(<AccountArSection accountId="acct-1" />);
    expect(screen.getByRole("heading", { name: "Accounts Receivable" })).toBeTruthy();
    expect(screen.getByText(/A summary of this account/)).toBeTruthy();
    const body = container.querySelectorAll("tbody tr");
    expect(body).toHaveLength(2);
    expect(body[0].textContent).toMatch(/Taylor Freezer of Arizona.*3.*\$640\.00.*1 · \$400\.00/);
    expect(body[1].textContent).toMatch(/Ventana.*1.*\$110\.00.*1 · \$110\.00/);
    expect(screen.getByText("4 open, 2 overdue.")).toBeTruthy();
    expect(container.querySelector("th")?.textContent).toBe("Company");
    expect(container.textContent).not.toMatch(/Position/);
  });

  it("a sales reader (restricted by the server) is told the totals cover only what is credited to them or their team", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: null, result: accountArFromBalanceSummary(A6_ANSWER([A6_TAYLOR], { restricted: true })) });
    render(<AccountArSection accountId="acct-1" />);
    expect(screen.getByText(/They cover only the receivables credited to you or your team/)).toBeTruthy();
    cleanup();
    useAccountAr.mockReturnValue({ loading: false, errorStatus: null, result: accountArFromBalanceSummary(A6_ANSWER([], { restricted: true })) });
    render(<AccountArSection accountId="acct-1" />);
    expect(screen.getByText(/within your companies \(limited to the receivables credited to you or your team\)/)).toBeTruthy();
  });

  it("an account with nothing open within the reader's companies says so, and shows no table", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: null, result: accountArFromBalanceSummary(A6_ANSWER([])) });
    const { container } = render(<AccountArSection accountId="acct-1" />);
    expect(screen.getByText(/No open receivables on this account within your companies/)).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
  });
});
