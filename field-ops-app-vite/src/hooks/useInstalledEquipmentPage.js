// INV-EQ-P1b -- cross-customer, cursor-paginated installed-Equipment read for the
// Customer Equipment tab. Reads the GOVERNED `equipmentRegister` source ORDERED BY
// DOCUMENT ID -- a deterministic cursor that includes legacy records lacking
// `createdAt` (they would be silently excluded by an orderBy(createdAt)). Names are
// resolved ONLY for the ids present in loaded pages, via BOUNDED batched reads --
// no unbounded name map, no per-row (N+1) reads. Rows, cursor, and name maps RESET
// when accessVersion changes. Fail-closed: a denied read is surfaced as denied; a
// first-page failure yields no rows; a later-page failure keeps loaded rows (partial).
//
// GOVERNED, NOT CLIENT-DIRECT. All three collections this touches -- equipment,
// accounts, locations -- are denied to clients in Rules now; the reads resolve
// service.equipment.read, customer.record.read and crm.location.read server-side.
// Same population as the admin/dispatcher grants they replace.
//
// NO REALTIME WAS LOST: this was already a one-shot paged read (getDocs), never a
// subscription, so nothing here depended on live updates.
//
// The seams (readEquipmentPage / readNames) remain injectable, so the paging logic
// is still testable without any client at all.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
import { ACCOUNTS_COLLECTION, LOCATIONS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";
import { collectAccountIds, collectLocationIds } from "../domain/installedEquipmentListView";

export const EQUIPMENT_PAGE_SIZE = 25;
const NAME_BATCH = 30; // the governed sources' declared `in` ceiling
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

// One page of the governed `equipmentRegister` source, which is ordered by DOCUMENT ID for exactly
// the reason this hook's header gives: ordering on createdAt would silently exclude legacy records
// missing that field, so a register would quietly lose rows rather than report fewer.
//
// THE CURSOR IS OPAQUE NOW and this hook never inspects it -- it round-trips whatever comes back as
// `lastId`, which is what the last-seen document id already was. Swapping a raw id for the server's
// page token is therefore invisible to the paging logic above.
async function defaultReadEquipmentPage({ cursor, pageSize }) {
  const outcome = await governedCollectionClient.readGovernedList({
    sourceId: "equipmentRegister",
    pageSize,
    cursor: cursor ?? undefined,
  });
  if (!outcome.ok) {
    // THROWS, as the getDocs it replaces did. The caller distinguishes denied from unavailable and
    // keeps already-loaded rows on a later-page failure; returning an empty page instead would read
    // as "the register ends here", silently truncating it.
    const err = new Error("equipment page read failed");
    err.code = outcome.result === "DENIED" ? "permission-denied" : "unavailable";
    throw err;
  }
  // The authoritative document id still wins over any stored `id`: the governed row carries the
  // document id in `id` (the projection places it last for this exact reason), and the compose step
  // preserves that precedence.
  const docs = outcome.items.map((row) => ({ ...row }));
  return {
    docs,
    lastId: outcome.nextCursor ?? cursor,
    // The hook's OWN heuristic, unchanged. The server reports an exact hasMore, but adopting it
    // would change when "Load more" disappears -- a behaviour change rather than a migration.
    hasMore: docs.length === pageSize,
  };
}

// Resolve names for ONLY the given ids, in bounded batches -- no unbounded name map, no per-row
// (N+1) reads. Batch size follows the governed sources' declared "in" ceiling.
const NAME_SOURCE_BY_COLLECTION = Object.freeze({
  [ACCOUNTS_COLLECTION]: "accountsByIds",
  [LOCATIONS_COLLECTION]: "locationsByIds",
});

async function defaultReadNames({ collectionName, ids }) {
  const sourceId = NAME_SOURCE_BY_COLLECTION[collectionName];
  if (!sourceId) {
    // A collection with no governed source is a programming error here, not a runtime condition to
    // absorb: silently returning an empty map would render every row's name as a raw id and look
    // like missing data.
    throw new Error(`no governed name source registered for "${collectionName}"`);
  }
  const map = new Map();
  for (let i = 0; i < ids.length; i += NAME_BATCH) {
    const batch = ids.slice(i, i + NAME_BATCH);
    if (batch.length === 0) continue;
    const outcome = await governedCollectionClient.readGovernedList({
      sourceId,
      filters: { ids: batch },
      pageSize: batch.length,
    });
    if (!outcome.ok) {
      const err = new Error(`name resolution failed for ${collectionName}`);
      err.code = outcome.result === "DENIED" ? "permission-denied" : "unavailable";
      throw err;
    }
    for (const row of outcome.items) {
      const { id, ...data } = row;
      const name = pickName(data);
      if (name) map.set(id, name);
    }
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
      // Name resolution is a SEPARATE, non-destructive step: the equipment read already
      // succeeded, so a name-lookup failure here must not discard the freshly-read rows
      // or flip the page to denied/error -- mirrors loadMore's handling below. Row
      // composition already falls back to raw ids for unresolved names.
      try {
        await resolveNames(pageDocs, runId);
      } catch (nameErr) {
        if (runId !== runIdRef.current) return;
        // The equipment page itself already loaded successfully -- a name-lookup
        // failure (including permission-denied on the accounts/locations side) is
        // non-destructive: rows stay, a partialError surfaces, row composition
        // falls back to raw ids.
        setPartialError(loadErrorMessage(nameErr, { entity: "equipment" }));
      }
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
