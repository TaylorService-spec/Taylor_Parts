// useMetadataList — readVia dispatch (X-INDEX-SURFACE-CALLABLE-READ).
//
// Before this, useMetadataList imported firestoreListSource's fetchPage unconditionally,
// so ANY entity declaring `readVia: "CALLABLE"` over a deny-all collection (opportunity,
// salesOrder today) could not have an INDEX surface at all — it would issue a live getDocs
// against a collection that denies everyone, permanently, including a caller genuinely
// holding the capability.
//
// THE FIRESTORE BRANCH IS GONE. Every metadata entity now reads through a trusted callable, so
// `selectListSource` has one live route and one failure route: CALLABLE with a resolved
// readCallable goes to the callable source, and everything else -- UNKNOWN readVia, CALLABLE with
// no readCallable, and now CLIENT_DIRECT itself -- fails loudly to UNAVAILABLE without touching any
// source.
//
// The CLIENT_DIRECT case is still tested, and it is the interesting one: it must NOT silently fall
// back to a Firestore read (there is no longer one to fall back to) and must NOT be quietly treated
// as callable. A definition declaring it is a configuration error, reported as unavailable.
// What is tested HERE is the routing decision; the translator's internals are covered by
// metadataCallableListSource.test.jsx.
//
// `def` and `entity` are built ONCE per test and reused across re-renders (never rebuilt
// inline inside the `renderHook` callback). buildQueryDescriptor's own descriptor is
// re-derived from their IDENTITY (useMemo deps), so a fresh object on every render would
// produce a fresh descriptor on every render, retrigger the load effect, and never settle
// — the real app avoids this because definitions are module-level constants built once,
// and a test that rebuilds them per render is testing something the app never does.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMetadataList } from "../src/hooks/useMetadataList.js";
import {
  makeEntityDefinition,
  makeFieldDefinition,
  makeIdentity,
} from "../src/metadata/entityDefinition.js";
import { makeListViewDefinition, makeColumn } from "../src/metadata/listViewDefinition.js";

const fetchCallablePageMock = vi.fn();
vi.mock("../src/metadata/callableListSource.js", () => ({
  fetchPage: (...args) => fetchCallablePageMock(...args),
}));

beforeEach(() => {
  fetchCallablePageMock.mockReset();
});

const makeEntity = (over = {}) =>
  makeEntityDefinition({
    id: "widget",
    label: "Widget",
    collection: "widgets",
    readVia: "CLIENT_DIRECT",
    identity: makeIdentity({ nameField: "name" }),
    fields: [makeFieldDefinition({ id: "name", entityId: "widget", label: "Name", type: "STRING", sortable: true })],
    ...over,
  });

const indexDef = makeListViewDefinition({
  id: "widget.index",
  entityId: "widget",
  label: "Widgets",
  surface: "INDEX",
  columns: [makeColumn({ fieldId: "name" })],
  pageSize: 25,
});

const page = (rows, over = {}) => ({ rows, hasMore: false, nextCursor: null, nextCursorDoc: null, ...over });

/** Renders the hook against a STABLE entity object — see the file header for why. */
const setup = (entityOver = {}) => {
  const entity = makeEntity(entityOver);
  return renderHook(() => useMetadataList(indexDef, entity));
};

describe("useMetadataList readVia dispatch", () => {
  it("CLIENT_DIRECT — fails loudly to UNAVAILABLE, and is NOT quietly routed to the callable source", async () => {
    // The direct-Firestore path is deleted. A definition still declaring CLIENT_DIRECT is a
    // configuration error, and the two wrong answers are both silent: falling back to a Firestore
    // read that no longer exists, or treating it as callable and reading through an authority it
    // never declared.
    const { result } = setup();
    await waitFor(() => expect(result.current.presentation.state).toBe("UNAVAILABLE"));
    expect(fetchCallablePageMock).not.toHaveBeenCalled();
    expect(result.current.presentation.rows).toHaveLength(0);
  });

  it("CALLABLE with a declared readCallable — routes to fetchCallablePage, never touching Firestore", async () => {
    fetchCallablePageMock.mockResolvedValue(page([{ id: "opp1" }]));
    const { result } = setup({ readVia: "CALLABLE", readCallable: "listOpportunityContext" });
    await waitFor(() => expect(result.current.presentation.state).toBe("READY"));
    expect(fetchCallablePageMock).toHaveBeenCalledTimes(1);
    expect(result.current.presentation.rows).toHaveLength(1);
  });

  it("UNKNOWN readVia fails loudly to UNAVAILABLE and touches no source", async () => {
    const { result } = setup({ readVia: "UNKNOWN" });
    await waitFor(() => expect(result.current.presentation.state).toBe("UNAVAILABLE"));
    expect(fetchCallablePageMock).not.toHaveBeenCalled();
  });

  it("CALLABLE with no readCallable declared fails loudly to UNAVAILABLE and touches no source", async () => {
    const { result } = setup({ readVia: "CALLABLE", readCallable: null });
    await waitFor(() => expect(result.current.presentation.state).toBe("UNAVAILABLE"));
    expect(fetchCallablePageMock).not.toHaveBeenCalled();
  });

  it("a truncated callable page discloses truncation the same way a truncated Firestore page does", async () => {
    fetchCallablePageMock.mockResolvedValue(page([{ id: "opp1" }], { hasMore: true }));
    const { result } = setup({ readVia: "CALLABLE", readCallable: "listOpportunityContext" });
    await waitFor(() => expect(result.current.presentation.state).toBe("READY"));
    expect(result.current.presentation.hasMore).toBe(true);
  });

  it("a denied callable read is DENIED, distinct from an unavailable read and from an empty one", async () => {
    const err = new Error("nope");
    err.code = "permission-denied";
    fetchCallablePageMock.mockRejectedValue(err);
    const { result } = setup({ readVia: "CALLABLE", readCallable: "listOpportunityContext" });
    await waitFor(() => expect(result.current.presentation.state).toBe("DENIED"));
  });

  it("a non-permission callable failure is UNAVAILABLE, not DENIED", async () => {
    const err = new Error("boom");
    err.code = "internal";
    fetchCallablePageMock.mockRejectedValue(err);
    const { result } = setup({ readVia: "CALLABLE", readCallable: "listOpportunityContext" });
    await waitFor(() => expect(result.current.presentation.state).toBe("UNAVAILABLE"));
  });

  it("an empty, successful callable read is EMPTY, not UNAVAILABLE or DENIED", async () => {
    fetchCallablePageMock.mockResolvedValue(page([]));
    const { result } = setup({ readVia: "CALLABLE", readCallable: "listOpportunityContext" });
    await waitFor(() => expect(result.current.presentation.state).toBe("EMPTY"));
  });
});

// X-ENTITY-SINGLE-READCALLABLE — a list view's own `readCallable` override.
//
// Before this, the descriptor's readCallable was always the ENTITY's (buildQueryDescriptor
// stamps `entity.readCallable` unconditionally, listRuntime.js). A list view declaring
// nothing must still behave EXACTLY as every test above -- that is `indexDef`, reused
// unchanged. A list view declaring its OWN readCallable must have it reach
// callableListSource.fetchPage instead of being silently dropped -- the ninth unconsumed
// declaration this change exists to not create.
describe("useMetadataList honors a list view's declared readCallable override", () => {
  const indexDefWithOverride = makeListViewDefinition({
    id: "widget.index",
    entityId: "widget",
    label: "Widgets",
    surface: "INDEX",
    columns: [makeColumn({ fieldId: "name" })],
    pageSize: 25,
    readCallable: "listOpportunityContext",
  });

  it("a list view with no declared readCallable falls back to the entity's own — additive, unchanged", async () => {
    fetchCallablePageMock.mockResolvedValue(page([{ id: "opp1" }]));
    const entity = makeEntity({ readVia: "CALLABLE", readCallable: "listSalesOrdersForAccount" });
    const { result } = renderHook(() => useMetadataList(indexDef, entity));
    await waitFor(() => expect(result.current.presentation.state).toBe("READY"));
    const [descriptor] = fetchCallablePageMock.mock.calls[0];
    expect(descriptor.readCallable).toBe("listSalesOrdersForAccount");
  });

  it("a list view's declared readCallable overrides the entity's own on the descriptor it actually reads through", async () => {
    fetchCallablePageMock.mockResolvedValue(page([{ id: "opp1" }]));
    // The entity's own readCallable is deliberately a DIFFERENT known callable, so a test
    // that passed by accident (descriptor still carrying the entity's value) would fail.
    const entity = makeEntity({ readVia: "CALLABLE", readCallable: "listSalesOrdersForAccount" });
    const { result } = renderHook(() => useMetadataList(indexDefWithOverride, entity));
    await waitFor(() => expect(result.current.presentation.state).toBe("READY"));
    expect(fetchCallablePageMock).toHaveBeenCalledTimes(1);
    const [descriptor] = fetchCallablePageMock.mock.calls[0];
    expect(descriptor.readCallable).toBe("listOpportunityContext");
  });

  it("routes to the callable source even when only the LIST VIEW declares a readCallable and the entity's own is absent", async () => {
    fetchCallablePageMock.mockResolvedValue(page([{ id: "opp1" }]));
    const entity = makeEntity({ readVia: "CALLABLE", readCallable: null });
    const { result } = renderHook(() => useMetadataList(indexDefWithOverride, entity));
    await waitFor(() => expect(result.current.presentation.state).toBe("READY"));
    const [descriptor] = fetchCallablePageMock.mock.calls[0];
    expect(descriptor.readCallable).toBe("listOpportunityContext");
  });
});
