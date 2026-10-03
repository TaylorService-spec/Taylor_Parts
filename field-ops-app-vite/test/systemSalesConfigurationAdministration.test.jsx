// Owner rulings #204 (2026-10-03): Administration -> System Configuration (company time zone, default language) and
// Sales Configuration (Employee Sales Authority). Each decides nothing: reads and changes go to /admin/policy with a reason,
// and a refusal is rendered as the server's answer.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminSystemConfiguration from "../src/modules/administration/AdminSystemConfiguration.jsx";
import AdminSalesConfiguration, { percentToBasisPoints } from "../src/modules/administration/AdminSalesConfiguration.jsx";

const CONFIG = {
  settings: [{ settingKey: "businessTimeZone" }, { settingKey: "defaultLanguage" }],
  supportedLanguages: [{ languageTag: "en-US", displayName: "English (United States)" }, { languageTag: "es-US", displayName: "Spanish (United States)" }],
  companies: [{ operatingCompanyId: "taylor", status: "ACTIVE", values: { businessTimeZone: { value: "America/Phoenix" }, defaultLanguage: { value: "en-US", source: "DEFAULT" } } }],
};

describe("System Configuration", () => {
  it("shows each company's time zone and language and changes the language with a reason", async () => {
    const callApi = vi.fn(async (op) => (op === "listSystemConfiguration" ? { ok: true, data: CONFIG } : { ok: true, data: {} }));
    render(<AdminSystemConfiguration callApi={callApi} />);
    await screen.findByText("America/Phoenix");
    expect(screen.getByRole("table").querySelector("tbody td:nth-child(3) div").textContent).toMatch(/^English \(United States\)/);
    expect(screen.getByText("(default)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New language for taylor"), { target: { value: "es-US" } });
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "bilingual staff" } });
    fireEvent.click(screen.getByRole("button", { name: "Set language for taylor" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("setSystemConfigurationSetting",
      { operatingCompanyId: "taylor", settingKey: "defaultLanguage", value: "es-US", reason: "bilingual staff" }));
  });

  it("renders the server's refusal", async () => {
    render(<AdminSystemConfiguration callApi={vi.fn(async () => ({ ok: false, code: "FORBIDDEN" }))} />);
    await screen.findByText(/admin.systemConfiguration.manage/);
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("Sales Configuration -- Employee Sales Authority", () => {
  const ITEMS = [
    { principalId: "p-1", displayName: "Riley Retail", state: "CONFIGURED", maxDiscountBasisPoints: 1000 },
    { principalId: "p-2", displayName: "Sam Seller", state: "CONFIGURED", maxDiscountBasisPoints: 0 },
    { principalId: "p-3", displayName: "Nia New", state: "NOT_CONFIGURED", maxDiscountBasisPoints: null },
  ];
  it("says each state in words -- not configured is not 0% and never unlimited", async () => {
    render(<AdminSalesConfiguration callApi={vi.fn(async () => ({ ok: true, data: { items: ITEMS } }))} />);
    await screen.findByText("Up to 10.00%");
    expect(screen.getByText("No discount authority (0%)")).toBeTruthy();
    expect(screen.getByText(/Not configured — no discount can be applied/)).toBeTruthy();
  });
  it("sends a percentage as whole basis points with a reason", async () => {
    const callApi = vi.fn(async (op) => (op === "listSalesDiscountAuthorities" ? { ok: true, data: { items: ITEMS } } : { ok: true, data: {} }));
    render(<AdminSalesConfiguration callApi={callApi} />);
    await screen.findByText("Up to 10.00%");
    fireEvent.change(screen.getByLabelText("Maximum discount percent for Nia New"), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "trained" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for Nia New" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("setSalesDiscountAuthority", { principalId: "p-3", maxDiscountBasisPoints: 1250, reason: "trained" }));
  });
  it("percent parsing is integer and bounded", () => {
    expect([percentToBasisPoints("10"), percentToBasisPoints("12.5"), percentToBasisPoints("0"), percentToBasisPoints("100"),
      percentToBasisPoints("100.01"), percentToBasisPoints("1.005"), percentToBasisPoints("-1"), percentToBasisPoints("")]).toEqual([1000, 1250, 0, 10000, null, null, null, null]);
  });
});
