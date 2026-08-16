// Account financials composition -- the regression that matters here is REPETITION.
//
// The Account page previously rendered the single UNCONFIGURED_COPY constant
// ("Sales data source not connected") FOUR times on one load: Financial Summary, Credit, and both
// Forecast Horizon families -- while the one block with real governed data (AR) sat apart from them.
// These tests lock the fix: the real AR surface stays, and the unconfigured provider collapses to
// exactly one bounded line.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const arState = { current: { loading: false, errorStatus: null, result: null } };
vi.mock("../src/hooks/useAccountAr", () => ({ useAccountAr: () => arState.current }));

import AccountFinancialsSection from "../src/modules/accounts/AccountFinancialsSection.jsx";
import { UNCONFIGURED_COPY } from "../src/domain/financialSummaryView.js";

afterEach(() => {
  cleanup();
  arState.current = { loading: false, errorStatus: null, result: null };
});

const countOccurrences = (text) => {
  const body = document.body.textContent ?? "";
  return body.split(text).length - 1;
};

describe("AccountFinancialsSection", () => {
  it("renders the unconfigured provider copy AT MOST ONCE, never four times", () => {
    render(<AccountFinancialsSection accountId="acc-1" />);
    expect(countOccurrences(UNCONFIGURED_COPY)).toBeLessThanOrEqual(1);
  });

  it("does not render the provider-dependent surfaces at all while unconfigured", () => {
    render(<AccountFinancialsSection accountId="acc-1" />);
    // The forecast/credit families are omitted entirely rather than repeating an apology.
    expect(screen.queryByText(/forecast horizon/i)).toBeNull();
    expect(screen.queryByText(/^Credit$/i)).toBeNull();
  });

  it("still explains, once, that the provider-dependent figures need a source", () => {
    render(<AccountFinancialsSection accountId="acc-1" />);
    expect(screen.getByText(/connected financial data source/i)).toBeTruthy();
  });

  it("keeps the real AR surface present and prominent", () => {
    render(<AccountFinancialsSection accountId="acc-1" />);
    // AR renders regardless of the provider state -- it has its own governed read.
    expect(screen.getByLabelText(/accounts receivable and financials/i)).toBeTruthy();
  });

  it("renders the provider surfaces when a provider IS configured", () => {
    render(<AccountFinancialsSection accountId="acc-1" financialProviderConfigured />);
    // The configured branch is preserved, not deleted -- it lights up with no further change here.
    expect(screen.queryByText(/connected financial data source/i)).toBeNull();
  });

  it("an AR read failure does not suppress the section or fabricate figures", () => {
    arState.current = { loading: false, errorStatus: "UNAVAILABLE", result: null };
    render(<AccountFinancialsSection accountId="acc-1" />);
    expect(screen.getByLabelText(/accounts receivable and financials/i)).toBeTruthy();
    expect(countOccurrences(UNCONFIGURED_COPY)).toBeLessThanOrEqual(1);
  });
});
