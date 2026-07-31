// INV-EQ-P1b -- cross-customer, cursor-paginated installed-Equipment read for the
// Customer Equipment tab. Reads the `equipment` collection (Rules already permit an
// admin/dispatcher cross-account read) ORDERED BY DOCUMENT ID -- a deterministic,
// index-free cursor that includes legacy records lacking `createdAt` (they would be
// silently excluded by an orderBy(createdAt)). Names are resolved ONLY for the ids
// present in loaded pages, via BOUNDED batched reads (<=10 ids per query) -- no
// unbounded name map, no per-row (N+1) reads. Rows, cursor, and name maps RESET when
// accessVersion changes. Fail-closed: a denied read is surfaced as denied; a first-
// page failure yields no rows; a later-page failure keeps loaded rows (partial).
//
// The firebase seams (readEquipmentPage / readNames) are injectable so the paging
// logic is testable without firebase.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, query, orderBy, limit, startAfter, getDocs, where, documentId } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { EQUIPMENT_COLLECTION, ACCOUNTS_COLLECTION, LOCATIONS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";
import { collectAccountIds, collectLocationIds } from "../domain/installedEquipmentListView";

export const EQUIPMENT_PAGE_SIZE = 25;
const NAME_BATCH = 10; // Firestore `in` limit (conservative)
const NAME_FIELDS = ["name", "label", "nickname", "title"]; // first present string wins

export function isPermissionDenied(err) {
  const code = typeof err?.code === "string" ? err.code : "";
  return code === "permission-denied" || code.endsWith("/permission-denied");
}

function pickName(data) {
  if (!data || typeof data !== "object") return null;
  for (const f of NAME_FIELDS) {
    if (typeof data[f] === "string" && data[f].trim() !== "") return data[f];
  }
  return null;
}

// Compose page rows from raw snapshot docs. The AUTHORITATIVE Firestore document id
// always wins over any stored `id` field (`...d.data()` first, then `id: d.id`), and
// the pagination cursor is derived from the snapshot document's id -- never from
// composed row data -- so stored data can neither change a row's identity/link nor
// corrupt the next-page cursor (skip/duplicate/misroute). Pure over {id, data()} docs.
export function composeEquipmentSnapshot(snapDocs) {
  const list = Array.isArray(snapDocs) ? snapDocs : [];
  const docs = list.map((d) => ({ ...(typeof d?.data === "function" ? d.data() : {}), id: d.id }));
  const lastId = list.length ? list[list.length - 1].id : null;
  return { docs, lastId };
}

// One page ordered by documentId(), starting after the last-seen id.
async function defaultReadEquipmentPage({ cursor, pageSize }) {
  const base = collection(db, EQUIPMENT_COLLECTION);
  const q = cursor
    ? query(base, orderBy(documentId()), startAfter(cursor), limit(pageSize))
    : query(base, orderBy(documentId()), limit(pageSize));
  const snap = await getDocs(q);
  const { docs, lastId } = composeEquipmentSnapshot(snap.docs);
  return { docs, lastId: lastId ?? cursor, hasMore: docs.length === pageSize };
}

// Resolve names for ONLY the given ids, in bounded batches.
async function defaultReadNames({ collectionName, ids }) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += NAME_BATCH) {
    const batch = ids.slice(i, i + NAME_BATCH);
    if (batch.length === 0) continue;
    const snap = await getDocs(query(collection(db, collectionName), where(documentId(), "in", batch)));
    snap.docs.forEach((d) => {
      const name = pickName(d.data());
      if (name) map.set(d.id, name);
    });
  }
  return map;
}

export function useInstalledEquipmentPage(accessVersion, deps = {}) {
  const readEquipmentPage = deps.readEquipmentPage ?? defaultReadEquipmentPage;
  const readNames = deps.readNames ?? defaultReadNames;
  const pageSize = deps.pageSize ?? EQUIPMENT_PAGE_SIZE;

  const [docs, setDocs] = useState([]);
  const [accountNames, setAccountNames] = useState(() => new Map());
  const [locationNames, setLocationNames] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);
  const [partialError, setPartialError] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef(null);
  const loadingRef = useRef(false); // synchronous guard against overlapping loadMore
  const runIdRef = useRef(0); // discards stale async results after a reset

  // Resolve + merge names for the NEW ids in a freshly loaded batch of docs.
  const resolveNames = useCallback(async (batchDocs, runId) => {
    const acctIds = collectAccountIds(batchDocs);
    const locIds = collectLocationIds(batchDocs);
    const [acctMap, locMap] = await Promise.all([
      acctIds.length ? readNames({ collectionName: ACCOUNTS_COLLECTION, ids: acctIds }) : new Map(),
      locIds.length ? readNames({ collectionName: LOCATIONS_COLLECTION, ids: locIds }) : new Map(),
    ]);
    if (runId !== runIdRef.current) return;
    if (acctMap && acctMap.size) setAccountNames((prev) => new Map([...prev, ...acctMap]));
    if (locMap && locMap.size) setLocationNames((prev) => new Map([...prev, ...locMap]));
  }, [readNames]);

  const loadFirstPage = useCallback(async () => {
    const runId = runIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setDenied(false);
    setPartialError(null);
    try {
      const { docs: pageDocs, lastId, hasMore: more } = await readEquipmentPage({ cursor: null, pageSize });
      if (runId !== runIdRef.current) return;
      cursorRef.current = lastId ?? null;
      setDocs(pageDocs);
      setHasMore(more === true);
      await resolveNames(pageDocs, runId);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setDocs([]);
      setHasMore(false);
      if (isPermissionDenied(err)) setDenied(true);
      else setError(loadErrorMessage(err, { entity: "equipment" }));
    } finally {
      if (runId === runIdRef.current) setLoading(false);
      loadingRef.current = false;
    }
  }, [readEquipmentPage, resolveNames, pageSize]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    const runId = runIdRef.current;
    loadingRef.current = true;
    setPartialError(null);
    try {
      const { docs: pageDocs, lastId, hasMore: more } = await readEquipmentPage({ cursor: cursorRef.current, pageSize });
      if (runId !== runIdRef.current) return;
      cursorRef.current = lastId ?? cursorRef.current;
      setDocs((prev) => [...prev, ...pageDocs]);
      setHasMore(more === true);
      await resolveNames(pageDocs, runId);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      // Keep already-loaded rows; surface a non-destructive partial error.
      if (isPermissionDenied(err)) setDenied(true);
      else setPartialError(loadErrorMessage(err, { entity: "equipment" }));
    } finally {
      loadingRef.current = false;
    }
  }, [readEquipmentPage, resolveNames, hasMore, pageSize]);

  // RESET everything on accessVersion change (grant/revoke) or mount, then load page 1.
  useEffect(() => {
    runIdRef.current += 1;
    cursorRef.current = null;
    setDocs([]);
    setAccountNames(new Map());
    setLocationNames(new Map());
    setHasMore(false);
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessVersion]);

  return useMemo(
    () => ({ docs, accountNames, locationNames, loading, error, denied, partialError, hasMore, loadMore }),
    [docs, accountNames, locationNames, loading, error, denied, partialError, hasMore, loadMore],
  );
}
