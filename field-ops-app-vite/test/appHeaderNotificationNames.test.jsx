// OD-3 -- NotificationControl integration with the REAL useCanonicalPartNames hook (vitest + jsdom).
// Proves NotificationControl owns ONE canonical read and threads a governed `resolveName`
// into NotificationPanel: READY -> canonical resolver; a denied read fails closed to the raw
// partId; and a same-UID accessVersion change invalidates the resolver synchronously. Only the
// Firebase-touching seams + heavy access-preview are mocked; the hook + composition are REAL.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1", email: "a@b.c" }, role: "admin", logout: () => {} }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [{ id: "r1", partId: "TST-9001", urgency: "HIGH" }] });
  return { useReorderRequests: r, useReorderRequestsByStatus: r, useReorderRequestsAssignedTo: r };
});
// canSeeReorderRequests is controlled per-test via a hoisted flag (default true so
// NotificationPanel mounts); set perm.canSee=false to simulate an unauthorized/non-notification role.
const perm = vi.hoisted(() => ({ canSee: true }));
vi.mock("../src/access/navPermissionPreview", () => ({ createPermissionPreviewer: () => () => perm.canSee }));
vi.mock("../src/access/resolveEffectivePermission", () => ({ resolveEffectivePermission: () => ({}) }));
vi.mock("../src/access/compatibilityRoles", () => ({ COMPATIBILITY_ROLES: {} }));
// Spy: capture the resolveName NotificationControl passes into NotificationPanel.
const captured = [];
vi.mock("../src/shared/ui/NotificationPanel", () => ({ default: ({ resolveName }) => { captured.push(resolveName); return null; } }));

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import NotificationControl from "../src/shared/ui/NotificationControl.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); captured.length = 0; perm.canSee = true; });

const latest = (id) => captured[captured.length - 1](id);
const READY = { ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }], invalid: [] };
const renderHeader = (accessVersion) => render(<MemoryRouter><NotificationControl accessVersion={accessVersion} /></MemoryRouter>);

describe("NotificationControl + NotificationPanel (OD-3)", () => {
  it("authorized (canSeeReorderRequests): ONE canonical read; the resolveName passed to NotificationPanel is canonical", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    renderHeader(1);
    await waitFor(() => expect(latest("TST-9001")).toBe("CANONICAL-NAME-A"));
    expect(fetchPartMasterList).toHaveBeenCalledTimes(1);        // exactly one shared read
    expect(latest("TST-0000-ABSENT")).toBe("TST-0000-ABSENT");   // absent -> raw partId
  });

  it("unauthorized / non-notification role (canSeeReorderRequests=false): ZERO canonical reads", async () => {
    perm.canSee = false;                                         // technician / no reorder-queue read access
    fetchPartMasterList.mockResolvedValue(READY);
    renderHeader(1);
    await act(async () => {});                                   // let any effects flush
    expect(fetchPartMasterList).toHaveBeenCalledTimes(0);        // NO canonical parts read issued
    expect(captured).toHaveLength(0);                            // NotificationPanel not mounted either
  });

  it("permission-denied canonical read: the resolver fails closed to the raw partId (never static)", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: false, code: "permission-denied" });
    renderHeader(1);
    // resolver is available synchronously; after the denied read settles it stays partId
    await act(async () => {});
    expect(latest("TST-9001")).toBe("TST-9001");
  });

  it("accessVersion change invalidates the resolver synchronously; stale old-boundary completion is dropped", async () => {
    const deferreds = [];
    fetchPartMasterList.mockImplementation(() => { let r; const p = new Promise((res) => { r = res; }); deferreds.push({ resolve: r }); return p; });
    const { rerender } = render(<MemoryRouter><NotificationControl accessVersion={1} /></MemoryRouter>);
    expect(deferreds).toHaveLength(1);                            // read #1 pending
    rerender(<MemoryRouter><NotificationControl accessVersion={2} /></MemoryRouter>);
    expect(deferreds).toHaveLength(2);                            // access change -> read #2
    expect(latest("TST-9001")).toBe("TST-9001");                 // resolver invalidated immediately

    // stale OLD read #1 resolves after the change -> must be dropped
    await act(async () => { deferreds[0].resolve({ ok: true, parts: [{ partId: "TST-9001", name: "STALE-OLD-NAME", category: "Valves", stockingUnit: "each" }], invalid: [] }); });
    expect(latest("TST-9001")).toBe("TST-9001");
    // current read #2 applies
    await act(async () => { deferreds[1].resolve(READY); });
    await waitFor(() => expect(latest("TST-9001")).toBe("CANONICAL-NAME-A"));
  });
});
