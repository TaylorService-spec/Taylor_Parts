// Application Assembly (#209): the persona workspace and site-wide search decide nothing -- the server's sections, refusals,
// people and results. OWNER / ACCOUNTABLE / ASSIGNEE stay three answers. Search exists only under EOS authority.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MyWorkspace from "../src/modules/workspace/MyWorkspace.jsx";
import SiteSearch from "../src/modules/search/SiteSearch.jsx";
import AppHeader from "../src/shared/ui/AppHeader.jsx";

const sec = (key, title, over = {}) => ({ key, title, status: "READY", reason: null, count: 0, items: [], ...over });
const WORK = {
  me: { principalId: "p1", employeeId: "e1", displayName: "Riley Retail", jobRole: { id: "retail-sales", label: "Retail Sales" } },
  persona: { key: "retail-sales", label: "Retail Sales", fromJobRole: true, analysisArea: "salesRetail" },
  operatingCompanyId: null,
  sections: [
    sec("attention", "Needs attention", { count: 1, items: [{ id: "o1", kind: "salesOrder", label: "SO-2026-000001", detail: "an order is waiting", status: "X", severity: "ATTENTION", priority: "HIGH", path: "/customers/opportunities/sales-order/o1" }] }),
    sec("ownedRecords", "Records I own", { count: 30, items: [{ id: "o1", kind: "salesOrder", label: "SO-2026-000001", detail: "Harbor Grill", status: "CONFIRMED", path: "/customers/opportunities/sales-order/o1",
      action: { responsibility: { owner: "Riley Retail", accountable: "Morgan Manager" } } }] }),
    sec("dispatchQueue", "Work to schedule and dispatch", { status: "NOT_AUTHORIZED", reason: "requires workOrder.lifecycle.schedule" }),
    sec("assignedWork", "Work assigned to me", { count: 1, items: [{ id: "w1", kind: "workOrder", label: "WO-1", detail: "PM", status: "SCHEDULED", path: "/service/work-orders/w1", action: { assignee: "Tech A" } }] }),
    sec("measures", "Key figures", { count: 1, summary: { period: { currentFirstDay: "2026-10-01", currentLastDay: "2026-10-03" }, scope: { note: null },
      measures: [{ id: "m1", name: "Orders booked", basis: "EOS_OPERATIONAL_ACTUAL", unit: "COUNT", status: "COMPUTED", value: { value: 4 }, aggregate: null, variance: { percent: 25 } },
        { id: "m2", name: "Margin", basis: "EOS_OPERATIONAL_ACTUAL", unit: "MONEY", status: "REFUSED", reason: "requires salesOrder.cost.read" }] } }),
  ],
  aiRequired: false,
};

const renderIn = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("MyWorkspace", () => {
  it("leads with attention, names the persona from the Job Role, keeps owner and accountable distinct, and says why a section is refused", async () => {
    const callApi = vi.fn(async () => ({ ok: true, result: WORK }));
    const { container } = renderIn(<MyWorkspace callApi={callApi} />);
    await screen.findByText("Riley Retail", { selector: "dd" });
    expect(container.textContent).toMatch(/My work — Retail Sales/);
    expect(container.textContent).toMatch(/High priority · an order is waiting/);
    expect(container.textContent).toMatch(/Owner: Riley Retail · Accountable: Morgan Manager/);
    expect(container.textContent).toMatch(/Assignee: Tech A/);
    expect(container.textContent).toMatch(/Not available to you — requires workOrder.lifecycle.schedule/);
    expect(container.textContent).toMatch(/Showing 1 of 30/);
    expect(container.textContent).toMatch(/\+25% vs prior/);
    expect(container.textContent).toMatch(/Not available to you — requires salesOrder.cost.read/);
    expect(screen.queryByLabelText("Company")).toBeNull();
    expect(callApi).toHaveBeenCalledWith("readMyWork", {});
  });

  it("offers the company projection to an executive and re-reads under it", async () => {
    const exec = { ...WORK, persona: { ...WORK.persona, key: "owner-executive", label: "Owner / Executive", analysisArea: "executive" }, operatingCompanyId: "consolidated" };
    const callApi = vi.fn(async () => ({ ok: true, result: exec }));
    renderIn(<MyWorkspace callApi={callApi} />);
    fireEvent.change(await screen.findByLabelText("Company"), { target: { value: "ventana" } });
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("readMyWork", { operatingCompanyId: "ventana" }));
  });

  it("states a refused workspace as the server's reason, never as an empty one", async () => {
    renderIn(<MyWorkspace callApi={vi.fn(async () => ({ ok: false, message: "sign in to reach your workspace" }))} />);
    await screen.findByText(/sign in to reach your workspace/);
  });
});

describe("SiteSearch", () => {
  it("sends only the words, links each result to its governed page, and says which kinds were not searched", async () => {
    const callApi = vi.fn(async () => ({ ok: true, result: { query: "harbor", notSearched: ["employee"], notSearchedLabels: ["Employee"],
      results: [{ kind: "account", kindLabel: "Customer", id: "a1", label: "Harbor Grill", detail: "ACTIVE", path: "/customers/a1" }] } }));
    renderIn(<SiteSearch callApi={callApi} />);
    fireEvent.change(screen.getByLabelText("Search EOS"), { target: { value: " harbor " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const link = await screen.findByRole("link", { name: "Harbor Grill" });
    expect(link.getAttribute("href")).toBe("/customers/a1");
    expect(callApi).toHaveBeenCalledWith("searchEos", { query: "harbor" });
    expect(screen.getByText(/Not searched with your access: Employee/)).toBeTruthy();
  });

  it("refuses a one-character query locally and makes no request", async () => {
    const callApi = vi.fn();
    renderIn(<SiteSearch callApi={callApi} />);
    fireEvent.change(screen.getByLabelText("Search EOS"), { target: { value: "h" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText(/at least two characters/);
    expect(callApi).not.toHaveBeenCalled();
  });

  it("the header carries search only when it is supplied (EOS authority); legacy keeps its empty strip", () => {
    const { container, rerender } = renderIn(<AppHeader />);
    expect(container.querySelector(".fo-appheader")).toBeNull();
    rerender(<MemoryRouter><AppHeader search={<SiteSearch callApi={vi.fn()} />} /></MemoryRouter>);
    expect(container.querySelector(".fo-appheader [role=search]")).not.toBeNull();
  });
});
