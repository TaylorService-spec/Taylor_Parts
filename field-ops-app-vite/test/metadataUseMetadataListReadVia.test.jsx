// useMetadataList — readVia dispatch (X-INDEX-SURFACE-CALLABLE-READ).
//
// Before this, useMetadataList imported firestoreListSource's fetchPage unconditionally,
// so ANY entity declaring `readVia: "CALLABLE"` over a deny-all collection (opportunity,
// salesOrder today) could not have an INDEX surface at all — it would issue a live getDocs
// against a collection that denies everyone, permanently, including a caller genuinely
// holding the capability.
//
// This mirrors MetadataRecordPage.jsx's own `selectListSource` for the RELATED surface
// (metadataRecordPage.test.jsx covers that one): CLIENT_DIRECT routes to Firestore,
// CALLABLE with a declared readCallable routes to the callable source, and anything else
// (UNKNOWN readVia, or CALLABLE with no readCallable) fails loudly without touching either
// source. What is tested HERE is the routing decision — the translators' own internals are
// covered by metadataFirestoreListSource.test.jsx and metadataCallableListSource.test.jsx.
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

const fetchFirestorePageMock = vi.fn();
vi.mock("../src/metadata/firestoreListSource.js", () => ({
  fetchPage: (...args) => fetchFirestorePageMock(...args),
}));

const fetchCallablePageMock = vi.fn();
vi.mock("../src/metadata/callableListSource.js", () => ({
  fetchPage: (...args) => fetchCallablePageMock(...args),
}));

beforeEach(() => {
  fetchFirestorePageMock.mockReset();
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
  it("CLIENT_DIRECT — routes to fetchFirestorePage, never touching the callable source (unchanged behavior)", async () => {
    fetchFirestorePageMock.mockResolvedValue(page([{ id: "w1" }]));
    const { result } = setup();
    await waitFor(() => expect(result.current.presentation.state).toBe("READY"));
    expect(fetchFirestorePageMock).toHaveBeenCalledTimes(1);
    expect(fetchCallablePageMock).not.toHaveBeenCalled();
    expect(result.current.presentation.rows).toHaveLength(1);
  });

  it("CALLABLE with a declared readCallable — routes to fetchCallablePage, never touching Firestore", async () => {
    fetchCallablePageMock.mockResolvedValue(page([{ id: "opp1" }]));
    const { result } = setup({ readVia: "CALLABLE", readCallable: "listOpportunityContext" });
    await waitFor(() => expect(result.current.presentation.state).toBe("READY"));
    expect(fetchCallablePageMock).toHaveBeenCalledTimes(1);
    expect(fetchFirestorePageMock).not.toHaveBeenCalled();
    expect(result.current.presentation.rows).toHaveLength(1);
  });

  it("UNKNOWN readVia fails loudly to UNAVAILABLE and touches no source", async () => {
    const { result } = setup({ readVia: "UNKNOWN" });
    await waitFor(() => expect(result.current.presentation.state).toBe("UNAVAILABLE"));
    expect(fetchFirestorePageMock).not.toHaveBeenCalled();
    expect(fetchCallablePageMock).not.toHaveBeenCalled();
  });

  it("CALLABLE with no readCallable declared fails loudly to UNAVAILABLE and touches no source", async () => {
    const { result } = setup({ readVia: "CALLABLE", readCallable: null });
    await waitFor(() => expect(result.current.presentation.state).toBe("UNAVAILABLE"));
    expect(fetchFirestorePageMock).not.toHaveBeenCalled();
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
