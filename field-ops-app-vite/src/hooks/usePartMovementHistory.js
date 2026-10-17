// ONE PART'S MOVEMENT HISTORY, FROM THE EOS INVENTORY LEDGER (Firebase exit F2-remainder, DECISIONS #246).
//
// This is what the Warehouse Manager's "Part Activity" panel reads where EOS is the session source, in place of the
// Firestore `inventory_actions` listener (hooks/useInventoryActions.js), a FROZEN collection whose writes stopped on
// 2026-08-30 and which was never a record of stock movement. (The frozen notes themselves stay readable beside it, labelled,
// until Owner decision D-246-1.) The source here is the opposite: eos_ops.inventory_movements,
// the sole quantity-mutating record, read through the governed readInventoryMovements for exactly this Part.
//
// The server decides everything that matters: the capability (inventory.transaction.read, the one the Warehouse Manager's
// whole home page already needs) and the caller's governed WAREHOUSE scope. No scope is an empty, honest answer. A refusal
// or a failure is an `error`, never an empty-looking list.
//
// BOUNDED: a read that does not answer in READ_TIMEOUT_MS settles as an error, so the panel never waits forever.
// PRINCIPAL-ISOLATED: the answer is held against the signed-in principal AND the Part. A different person, or a different
// Part, never sees the previous answer, not even for the render before the new read starts.
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { boundedRead, READ_TIMEOUT_MS } from "../access/boundedRead.js";
import { fetchInventoryMovements } from "../services/partsOperationsReads.js";
import { partActivityRows } from "../domain/partsNorthStar.js";
import { toLedgerTransaction } from "./useInventoryLedger.js";

/** The newest N movements are shown; the server reports `truncated` when there were more. */
export const PART_MOVEMENT_LIMIT = 200;

const EMPTY = Object.freeze({ data: Object.freeze([]), loading: false, error: null, truncated: false });

/** Test seam and pure core: one governed read, as `{ rows, truncated }` or a thrown error carrying its code. */
export async function readPartMovements(partId, { fetchMovements = fetchInventoryMovements, signal } = {}) {
  const result = await fetchMovements({ partIds: [partId], limit: PART_MOVEMENT_LIMIT }, signal ? { signal } : undefined);
  return { rows: partActivityRows((result?.items ?? []).map(toLedgerTransaction)), truncated: result?.truncated === true };
}

export function usePartMovementHistory(partId, { fetchMovements } = {}) {
  const uid = useAuth()?.user?.uid ?? "";
  const key = partId ? `${uid}|${partId}` : "";
  const [state, setState] = useState({ key, data: [], loading: Boolean(partId), error: null, truncated: false });

  useEffect(() => {
    if (!key) { setState({ key, ...EMPTY }); return undefined; }
    let cancelled = false;
    setState({ key, data: [], loading: true, error: null, truncated: false });
    boundedRead(
      (signal) => readPartMovements(partId, { fetchMovements, signal }).then(
        (ok) => ({ ok: true, ...ok }),
        (err) => ({ ok: false, error: err?.code ?? "unknown" }),
      ),
      READ_TIMEOUT_MS,
      { ok: false, error: "UNREACHABLE" },
    ).then((answer) => {
      if (cancelled) return;
      setState(answer.ok
        ? { key, data: answer.rows, loading: false, error: null, truncated: answer.truncated }
        : { key, data: [], loading: false, error: answer.error, truncated: false });
    });
    return () => { cancelled = true; };
    // fetchMovements is an injection seam for tests; the production default is a stable module function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The render between a principal / Part change and the effect above must not paint the previous answer.
  if (state.key !== key) return { data: [], loading: Boolean(partId), error: null, truncated: false };
  return { data: state.data, loading: state.loading, error: state.error, truncated: state.truncated };
}
