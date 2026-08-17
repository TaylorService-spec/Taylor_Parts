// Customers — the migrated surface.
//
// The contract under test is the one the product ruling fixed: the headline numbers are
// claims about the whole book of business and must never be computed from the rows on
// screen, and the page must own no unbounded read.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const listState = { presentation: null };
const summaryState = { summary: null, state: "LOADING" };

vi.mock("../src/hooks/useMetadataList", () => ({
  useMetadataList: () => ({ presentation: listState.presentation, loadMore: vi.fn(), retry: vi.fn() }),
}));
vi.mock("../src/hooks/useAccountPortfolioSummary", () => ({
  useAccountPortfolioSummary: () => ({ ...summaryState, retry: vi.fn() }),
}));
// If the page ever reacquires a collection subscription, this mock is the tripwire: the
// import would resolve and the test asserting it is unused would fail.
const subscribeSpy = vi.fn(() => ({ data: [], loading: false, error: null }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: subscribeSpy }));

const { default: AccountsList } = await import("../src/modules/accounts/AccountsList.jsx");

const readyList = (rows = []) => ({
  listId: "account.index",
  surface: "INDEX",
  state: rows.length ? "READY" : "EMPTY",
  columns: [{ fieldId: "name", label: "Customer" }],
  rows: rows.map((r) => ({ key: r.id, cells: [{ fieldId: "name", value: r.name }] })),
  hasMore: false,
  viewAllListId: null,
  truncated: false,
  emptyMessage: "No customers yet.",
});

const renderPage = () => render(<MemoryRouter><AccountsList /></MemoryRouter>);

beforeEach(() => {
  subscribeSpy.mockClear();
  listState.presentation = readyList([{ id: "a1", name: "Northside Foods" }]);
  summaryState.summary = null;
  summaryState.state = "LOADING";
});

describe("Customers surface", () => {
  it("owns no collection subscription — the page is a query result, not a dataset", () => {
    renderPage();
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it("card counts come from the governed summary, not from the rows on screen", () => {
    // One row is rendered; the totals say 250,000. If the cards were derived from the
    // page, this is the assertion that would fail.
    summaryState.state = "READY";
    summaryState.summary = { total: 250000, byStatus: { ACTIVE: 190000, PROSPECT: 30000, INACTIVE: 20000, ARCHIVED: 10000 }, unclassified: 0 };
    renderPage();
    expect(screen.getByText("250000")).toBeTruthy();
    expect(screen.getByText("190000")).toBeTruthy();
  });

  it("an unavailable total shows a dash, never a zero", () => {
    // "0 Active" is a claim about the business. "—" is a claim about the read. They are
    // not interchangeable, and the zero is the one that gets believed.
    summaryState.state = "UNAVAILABLE";
    renderPage();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText(/totals could not be loaded/i)).toBeTruthy();
  });

  it("a denied summary says so, and does not read as missing data", () => {
    summaryState.state = "DENIED";
    renderPage();
    expect(screen.getByText(/not available to you/i)).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  it("statuses outside the standard set are disclosed, not absorbed", () => {
    // The production status audit is still open. Four categories that quietly fail to add
    // up to the total is exactly the silent lie the aggregate was built to prevent.
    summaryState.state = "READY";
    summaryState.summary = { total: 10, byStatus: { ACTIVE: 6, PROSPECT: 1, INACTIVE: 0, ARCHIVED: 0 }, unclassified: 3 };
    renderPage();
    expect(screen.getByText(/3 customers have statuses outside the standard set/i)).toBeTruthy();
  });

  it("a clean book of business shows no discrepancy notice", () => {
    summaryState.state = "READY";
    summaryState.summary = { total: 7, byStatus: { ACTIVE: 7, PROSPECT: 0, INACTIVE: 0, ARCHIVED: 0 }, unclassified: 0 };
    renderPage();
    expect(screen.queryByText(/outside the standard set/i)).toBeNull();
  });

  it("renders the list through the metadata grid, including its empty state", () => {
    listState.presentation = readyList([]);
    renderPage();
    expect(screen.getByText("No customers yet.")).toBeTruthy();
  });

  it("offers no global search it cannot answer completely", () => {
    // The provider filtered an array only the whole-collection subscription could supply.
    // Handing it a page would return "no results" for customers that exist.
    renderPage();
    expect(screen.queryByPlaceholderText(/search customers/i)).toBeNull();
  });
});
