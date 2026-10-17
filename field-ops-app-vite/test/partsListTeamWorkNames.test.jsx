// FIREBASE EXIT F4 (DECISIONS #247) -- Parts > Team Work names each assignee through the governed (EOS) Employee-name read.
// Run: npx vitest run test/partsListTeamWorkNames.test.jsx
//
// Reorder Requests are EOS rows and name their assignee by EMPLOYEE id (assignedEmployeeId). The page used to look that id up in
// the whole Firestore employee directory (keyed by Firebase uid), so it could not name it. It now asks resolveEmployeeDisplayNames
// for exactly the Employee ids on the rows, and a refusal reads "Unknown assignee" -- never the id.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => { const searchParts = vi.fn(); return { searchParts, readPartsForView: (partIds) => searchParts({ partIds }), isCatalogReadRefused: () => false }; });
vi.mock("../src/data/partsCatalog", () => ({ PARTS_CATALOG: [], getCatalogItem: () => undefined }));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ healthEntries: [], loading: false, error: null }) }));
const assigned = vi.hoisted(() => ({ rows: [] }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const empty = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequests: empty, useReorderRequestsByStatus: empty, useMyAssignedReorderRequests: empty, useReorderRequestsHistory: empty, useReorderRequestById: empty,
    useReorderRequestsByStatuses: () => ({ data: assigned.rows, loading: false, error: null }),
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: (r) => r.requestedQty ?? 0 }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
const directory = vi.hoisted(() => ({ asked: [], names: new Map(), error: null, loading: false }));
vi.mock("../src/hooks/useGovernedEmployeeDirectory.js", () => ({
  useGovernedEmployeeDirectory: (args) => { directory.asked.push(args); return { byEmployeeId: directory.names, byUserId: new Map(), loading: directory.loading, error: directory.error }; },
}));
vi.mock("../src/hooks/useEmployeeDirectory", () => { throw new Error("PartsList must not read the Firestore employee directory"); });
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/shared/search/GlobalSearch", () => ({ default: () => null }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));
vi.mock("../src/shared/ui/FilterBar", () => ({ default: () => null }));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { searchParts } from "../src/services/partMasterQueries";
import PartsList, { resolveAssigneeDisplay } from "../src/modules/inventory/PartsList.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); directory.asked.length = 0; directory.names = new Map(); directory.error = null; directory.loading = false; assigned.rows = []; });

const row = (id, assignedEmployeeId) => ({ id, partId: "P-1", status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedEmployeeId, requestedQty: 2, urgency: "HIGH", assignedAt: Date.now() - 3600_000 });

async function teamWorkTable() {
  searchParts.mockResolvedValue({ ok: true, parts: [], invalid: [] });
  render(<PartsList />);
  const heading = await screen.findByRole("heading", { name: /All Assigned Work/ });
  return heading.parentElement.querySelector("table");
}

describe("Parts > Team Work -- assignee names", () => {
  it("asks the governed read for exactly the Employee ids on the rows and renders the names it is given", async () => {
    assigned.rows = [row("rr-1", "emp-1"), row("rr-2", "emp-2")];
    directory.names = new Map([["emp-1", { id: "emp-1", displayName: "Pat Associate" }], ["emp-2", { id: "emp-2", displayName: "Sam Associate" }]]);
    const table = await teamWorkTable();
    expect(directory.asked.at(-1)).toEqual({ employeeIds: ["emp-1", "emp-2"] });
    expect(within(table).getByText("Pat Associate")).toBeTruthy();
    expect(within(table).getByText("Sam Associate")).toBeTruthy();
  });

  it("a refused read leaves 'Unknown assignee' -- never the Employee id", async () => {
    assigned.rows = [row("rr-1", "emp-1")];
    directory.error = { ok: false, code: "FORBIDDEN" };
    const table = await teamWorkTable();
    expect(within(table).getByText("Unknown assignee")).toBeTruthy();
    expect(within(table).queryByText("emp-1")).toBeNull();
  });

  it("an id the read does not name is 'Unknown assignee' too", () => {
    expect(resolveAssigneeDisplay("emp-9", new Map(), false, null)).toBe("Unknown assignee");
    expect(resolveAssigneeDisplay(null, new Map(), false, null)).toBe("—");
  });
});
