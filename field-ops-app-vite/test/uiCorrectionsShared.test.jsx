// UI CORRECTIONS PACKAGE (2026-10-08) -- the shared patterns (item H) and the behaviours built on them:
// display labels (A), the tri-state column sort (C), tabs (D), the typeahead (E) and the Users roster (B, C, E).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { identifierLabel, operatingCompanyLabel, sentenceCase, statusLabel, titleCase, titleCasePhrase } from "../src/shared/display/displayLabels.js";
import { nextSort, sortRows, useTableSort } from "../src/shared/ui/sorting/useTableSort.js";
import SortableHeader from "../src/shared/ui/sorting/SortableHeader.jsx";
import Tabs, { useUrlTab } from "../src/shared/ui/Tabs.jsx";
import Autocomplete, { searchLoaded } from "../src/shared/ui/Autocomplete.jsx";
import WorkforceRoster from "../src/modules/administration/WorkforceRoster.jsx";

afterEach(cleanup);

describe("display labels (item A)", () => {
  it("turns internal identifiers into Title Case words and keeps the identifier itself untouched", () => {
    expect(titleCase("partsManager")).toBe("Parts Manager");
    expect(titleCase("workOrder")).toBe("Work Order");
    expect(titleCase("IN_PROGRESS")).toBe("In Progress");
    expect(titleCase("salesOrder.write")).toBe("Sales Order Write");
    expect(titleCase("crm_account_id")).toBe("CRM Account ID");
    expect(titleCasePhrase("roles and permissions of the user")).toBe("Roles and Permissions of the User");
    expect(sentenceCase("type at least 2 characters.")).toBe("Type at least 2 characters.");
  });

  it("operating companies come from the governed table: short 'Taylor', full displayName, unknown humanised never raw", () => {
    expect(operatingCompanyLabel("taylor")).toBe("Taylor");
    expect(operatingCompanyLabel("ventana")).toBe("Ventana");
    expect(operatingCompanyLabel("taylor", { short: false })).toBe("Taylor Freezer of Arizona");
    expect(operatingCompanyLabel("new_company")).toBe("New Company");
  });

  it("a server display name wins over the key; a key-shaped name is humanised; statuses use a domain map first", () => {
    expect(identifierLabel("salesManager", "Sales Manager")).toBe("Sales Manager");
    expect(identifierLabel("salesManager", "salesManager")).toBe("Sales Manager");
    expect(identifierLabel("admin")).toBe("Admin");
    expect(statusLabel("ON_LEAVE")).toBe("On Leave");
    expect(statusLabel("ACTIVE", { ACTIVE: "Employee Active" })).toBe("Employee Active");
  });
});

describe("tri-state column sort (item C)", () => {
  it("cycles ascending -> descending -> default, per column", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({ key: "name", direction: "desc" });
    expect(nextSort({ key: "name", direction: "desc" }, "name")).toBeNull();
    expect(nextSort({ key: "name", direction: "desc" }, "status")).toEqual({ key: "status", direction: "asc" });
  });

  it("sorts a copy, keeps empty values last in both directions, and is stable (the default order breaks ties)", () => {
    const rows = [{ id: 1, v: "b" }, { id: 2, v: "" }, { id: 3, v: "a" }, { id: 4, v: "b" }];
    const columns = { v: { value: (r) => r.v } };
    expect(sortRows(rows, { key: "v", direction: "asc" }, columns).map((r) => r.id)).toEqual([3, 1, 4, 2]);
    expect(sortRows(rows, { key: "v", direction: "desc" }, columns).map((r) => r.id)).toEqual([1, 4, 3, 2]);
    expect(sortRows(rows, null, columns)).toBe(rows);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it("SortableHeader is a keyboard-reachable button with aria-sort and a visible indicator", () => {
    function Table() {
      const rows = [{ n: "Bea" }, { n: "Al" }, { n: "Cy" }];
      const { sort, toggle, sorted } = useTableSort({ rows, columns: { n: { value: (r) => r.n } } });
      return (
        <table><thead><tr><SortableHeader columnKey="n" label="Name" sort={sort} onSort={toggle} /></tr></thead>
          <tbody>{sorted.map((r) => <tr key={r.n}><td>{r.n}</td></tr>)}</tbody></table>
      );
    }
    render(<Table />);
    const th = screen.getByRole("columnheader");
    const button = within(th).getByRole("button");
    const names = () => screen.getAllByRole("cell").map((c) => c.textContent);
    expect(th.getAttribute("aria-sort")).toBe("none");
    expect(names()).toEqual(["Bea", "Al", "Cy"]);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    expect(th.textContent).toMatch(/▲/);
    expect(names()).toEqual(["Al", "Bea", "Cy"]);
    fireEvent.click(button);
    expect(th.getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["Cy", "Bea", "Al"]);
    fireEvent.click(button);
    expect(th.getAttribute("aria-sort")).toBe("none");
    expect(names()).toEqual(["Bea", "Al", "Cy"]);
  });
});

describe("tabs (item D)", () => {
  const TABS = [{ id: "overview" }, { id: "access" }, { id: "activity" }];
  function Page() {
    const [active, select] = useUrlTab(TABS);
    const location = useLocation();
    return (
      <>
        <span data-testid="search">{location.search}</span>
        <Tabs label="Record" active={active} onSelect={select} tabs={[
          { id: "overview", label: "Overview", render: () => <p>overview body</p> },
          { id: "access", label: "Roles & Access", render: () => <p>access body</p> },
          { id: "activity", label: "Activity", render: () => <p>activity body</p> },
        ]} />
      </>
    );
  }
  const renderAt = (url) => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/r" element={<Page />} /></Routes></MemoryRouter>);

  it("opens on ?tab=, mounts only the active panel, and keeps the choice in the URL", () => {
    renderAt("/r?tab=access");
    expect(screen.getByRole("tab", { name: "Roles & Access" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("access body")).toBeTruthy();
    expect(screen.queryByText("overview body")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=activity");
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByTestId("search").textContent).toBe("");
  });

  it("Left/Right/Home/End move between tabs and focus follows; an unknown ?tab= falls back to the first", () => {
    renderAt("/r?tab=nope");
    const overview = screen.getByRole("tab", { name: "Overview" });
    expect(overview.getAttribute("aria-selected")).toBe("true");
    expect(overview.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Roles & Access" }));
    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Overview" }).id);
  });
});

describe("typeahead (item E)", () => {
  it("does not search below 2 characters, debounces ~250 ms, and drops a STALE answer", async () => {
    vi.useFakeTimers();
    try {
      const resolvers = {};
      const search = vi.fn((q) => new Promise((resolve) => { resolvers[q] = resolve; }));
      render(<Autocomplete label="Find" search={search} getKey={(i) => i.id} getLabel={(i) => i.label} />);
      const box = screen.getByRole("combobox", { name: "Find" });
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "j" } });
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(search).not.toHaveBeenCalled();
      fireEvent.change(box, { target: { value: "jo" } });
      await act(async () => { vi.advanceTimersByTime(200); });
      expect(search).not.toHaveBeenCalled(); // still debouncing
      await act(async () => { vi.advanceTimersByTime(60); });
      expect(search).toHaveBeenCalledTimes(1);
      fireEvent.change(box, { target: { value: "john" } });
      await act(async () => { vi.advanceTimersByTime(260); });
      expect(search).toHaveBeenCalledTimes(2);
      // "john" answers first, then the slow "jo" answer arrives: it must NOT replace the list.
      await act(async () => { resolvers.john({ ok: true, items: [{ id: "1", label: "John Smith" }] }); });
      await act(async () => { resolvers.jo({ ok: true, items: [{ id: "2", label: "Joan Old" }] }); });
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["John Smith"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a keyboard combobox: arrows move, Enter chooses, Escape closes; View All Results is offered", async () => {
    const onSelect = vi.fn();
    const onViewAll = vi.fn();
    const items = [{ id: "1", label: "Alpha Co" }, { id: "2", label: "Alpine Ltd" }];
    render(<Autocomplete label="Customer" search={searchLoaded(items, (i) => i.label)} getKey={(i) => i.id} getLabel={(i) => i.label} onSelect={onSelect} onViewAll={onViewAll} />);
    const box = screen.getByRole("combobox", { name: "Customer" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "al" } });
    await screen.findByRole("option", { name: "Alpha Co" });
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("option", { name: /View All Results for “al”/ })).toBeTruthy();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Alpine Ltd" }).id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(items[1]);
    expect(box.value).toBe("Alpine Ltd");
    fireEvent.change(box, { target: { value: "alp" } });
    await screen.findByRole("option", { name: "Alpha Co" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onViewAll).toHaveBeenCalledWith("alp");
  });

  it("a refused search is a stated refusal, never an empty list", async () => {
    render(<Autocomplete label="Find" search={async () => ({ ok: false, code: "FORBIDDEN" })} getKey={(i) => i.id} getLabel={(i) => i.label} />);
    const box = screen.getByRole("combobox", { name: "Find" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "ab" } });
    expect(await screen.findByText("Searching here is not available to you.")).toBeTruthy();
    expect(screen.queryByText("No matches.")).toBeNull();
  });
});

describe("Administration → Users roster (items B, C, E)", () => {
  const person = (i, last, first, extra = {}) => ({
    employeeId: `emp-${i}`, displayName: `${first} ${last}`, firstName: first, lastName: last, employeeNumber: `E-${i}`,
    employmentStatus: "ACTIVE", operatingCompanyId: "taylor", jobTitle: null, jobRole: null, manager: null,
    workEligibility: [], operationalScopes: [], applicationUser: "LINKED", principalId: null, securityRoles: [], ...extra,
  });
  const makeRoster = (items) => ({
    call: vi.fn(async (operation, input) => ({
      ok: true,
      result: { items: input.limit ? items.slice(0, input.limit) : items, total: items.length, truncated: false, securityRolesWithheld: null,
        sort: input.sort ?? { key: "name", direction: "asc", isDefault: true },
        facets: { jobRoles: [], securityRoles: [], operatingCompanies: [], statuses: [{ status: "ACTIVE", count: items.length }] } },
    })),
  });
  const renderRoster = (workforce) => render(<MemoryRouter><WorkforceRoster workforce={workforce} /></MemoryRouter>);

  it("asks the server for its DEFAULT order (no sort sent), renders companies by name, and every column header sorts on the SERVER", async () => {
    const workforce = makeRoster([person(1, "Adams", "Zoe"), person(2, "Baker", "Al")]);
    renderRoster(workforce);
    await screen.findByText("Zoe Adams");
    expect(workforce.call.mock.calls[0]).toEqual(["listWorkforceRoster", {}]);
    expect(screen.getAllByText("Taylor").length).toBeGreaterThan(0);
    expect(screen.queryByText("taylor")).toBeNull();
    const headers = screen.getAllByRole("columnheader").map((h) => h.getAttribute("data-sort-key"));
    expect(headers).toEqual(["name", "employeeNumber", "jobRole", "securityRoles", "operatingCompany", "status", "scope", "manager"]);
    const statusHeader = screen.getByRole("columnheader", { name: /Status/ });
    fireEvent.click(within(statusHeader).getByRole("button"));
    await waitFor(() => expect(workforce.call.mock.calls.at(-1)[1]).toEqual({ sort: { key: "status", direction: "asc" } }));
    fireEvent.click(within(statusHeader).getByRole("button"));
    await waitFor(() => expect(workforce.call.mock.calls.at(-1)[1]).toEqual({ sort: { key: "status", direction: "desc" } }));
    fireEvent.click(within(statusHeader).getByRole("button"));
    await waitFor(() => expect(workforce.call.mock.calls.at(-1)[1]).toEqual({}));
  });

  it("pages the sorted, filtered set 50 at a time and keeps the sort and filter across pages", async () => {
    const many = Array.from({ length: 120 }, (_, i) => person(i, `Last${String(i).padStart(3, "0")}`, "Pat"));
    const workforce = makeRoster(many);
    renderRoster(workforce);
    await screen.findByText("Pat Last000");
    expect(document.querySelectorAll("[data-employee-row]").length).toBe(50);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    expect(screen.getByText("Pat Last050")).toBeTruthy();
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    // A sort change returns to page 1 (of the newly ordered whole).
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Employee ID/ })).getByRole("button"));
    await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeTruthy());
  });

  it("suggests people as you type (server read, limit 8); Enter / View All filters the table to every match", async () => {
    const workforce = makeRoster([person(1, "Adams", "Zoe"), person(2, "Baker", "Al")]);
    renderRoster(workforce);
    await screen.findByText("Zoe Adams");
    const box = screen.getByRole("combobox", { name: "Search" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "zo" } });
    await waitFor(() => expect(workforce.call.mock.calls.some(([, input]) => input.query === "zo" && input.limit === 8)).toBe(true));
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(workforce.call.mock.calls.at(-1)[1]).toEqual({ query: "zo" }));
    expect(document.querySelector('[data-roster-query="zo"]')).toBeTruthy();
  });

  it("draws only the LATEST table read (stale responses are dropped)", async () => {
    let release;
    const workforce = {
      call: vi.fn((operation, input) => {
        const tag = input.sort ? input.sort.direction : "default";
        const result = { items: [person(1, tag === "asc" ? "Ascending" : tag === "desc" ? "Descending" : "Default", "Row")], total: 1, truncated: false,
          securityRolesWithheld: null, facets: { jobRoles: [], securityRoles: [], operatingCompanies: [], statuses: [] } };
        // The ascending read is SLOW: it answers after the descending one.
        if (tag === "asc") return new Promise((resolve) => { release = () => resolve({ ok: true, result }); });
        return Promise.resolve({ ok: true, result });
      }),
    };
    renderRoster(workforce);
    await screen.findByText("Row Default");
    const header = within(document.querySelector('th[data-sort-key="name"]')).getByRole("button");
    fireEvent.click(header); // asc (slow)
    fireEvent.click(header); // desc (fast)
    await screen.findByText("Row Descending");
    await act(async () => { release(); });
    expect(screen.queryByText("Row Ascending")).toBeNull();
    expect(screen.getByText("Row Descending")).toBeTruthy();
  });
});
