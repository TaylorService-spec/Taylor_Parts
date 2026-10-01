import { useEffect, useState } from "react";
import { subscribeToWorkOrders } from "../services/workOrderService";
import { loadErrorMessage } from "../domain/loadErrorMessage";
import { equipmentApiClient, EQUIPMENT_LIST_MAX, onEquipmentChanged, toEquipmentView } from "../services/equipmentApiClient.js";

// THE EQUIPMENT READ PATH IS THE GOVERNED POSTGRESQL REGISTER (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01).
//
// Every read is ONE bounded, server-authorized call on /operations/equipment -- never a Firestore query, never a
// per-record loop. The server decides what this caller may see (operational readers: the register; a seller: its
// channel's customers; anyone else: nothing), so a refused read is rendered as refused, never as "no equipment".
// A successful write anywhere in the app notifies (onEquipmentChanged) and every mounted read re-reads.

/** A safe, user-facing sentence for a failed register read. Never a code path or an id. */
export function equipmentReadErrorMessage(res) {
  if (!res || res.ok) return null;
  if (res.code === "NOT_ACTIVATED") return "The Equipment register is not yet activated on EOS (NOT_YET_ACTIVATED).";
  if (res.code === "FORBIDDEN") return "You do not have permission to view this equipment.";
  if (res.code === "NOT_FOUND") return "This equipment could not be found.";
  if (res.code === "NOT_CONFIGURED" || res.code === "NOT_SIGNED_IN" || res.code === "UNREACHABLE") return "The Equipment register could not be reached.";
  return "Equipment could not be loaded.";
}

function useRegisterRead(operation, input, enabled, project, client = equipmentApiClient) {
  const key = JSON.stringify(input ?? null);
  const [state, setState] = useState({ value: null, loading: Boolean(enabled), error: null, failure: null });
  const [tick, setTick] = useState(0);
  useEffect(() => onEquipmentChanged(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (!enabled) {
      setState({ value: null, loading: false, error: null, failure: null });
      return undefined;
    }
    let live = true;
    // A re-read after a change keeps the record on screen (no loading flash); only a first read is LOADING.
    setState((s) => ({ ...s, loading: s.value === null, error: null }));
    client.call(operation, JSON.parse(key)).then((res) => {
      if (!live) return;
      if (res.ok) setState({ value: project(res.result), loading: false, error: null, failure: null });
      else setState({ value: null, loading: false, error: equipmentReadErrorMessage(res), failure: res });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the input, serialized
  }, [operation, key, enabled, tick, client]);
  return state;
}

// Account-scoped: the equipment installed anywhere at one customer (one bounded server-filtered read).
export function useEquipmentForAccount(accountId, { client } = {}) {
  const { value, loading, error } = useRegisterRead("listEquipment", { accountId, limit: EQUIPMENT_LIST_MAX }, Boolean(accountId),
    (r) => (r.equipment ?? []).map(toEquipmentView), client);
  return { data: value ?? [], loading, error };
}

// The tenant register, filtered and searched SERVER-side (Customer Equipment).
export function useEquipmentRegister({ search, status, accountId } = {}, { client } = {}) {
  const input = { limit: EQUIPMENT_LIST_MAX };
  if (typeof search === "string" && search.trim() !== "") input.search = search.trim();
  if (status) input.status = status;
  if (accountId) input.accountId = accountId;
  const { value, loading, error } = useRegisterRead("listEquipment", input, true,
    (r) => ({ rows: (r.equipment ?? []).map(toEquipmentView), hasMore: r.nextCursor != null }), client);
  return { data: value?.rows ?? [], hasMore: value?.hasMore ?? false, loading, error };
}

// Issue #232 unit E7 -- the Work Orders linked to ONE piece of equipment, for the
// detail page's linked-Work-Orders section and its derived Service History (§10).
//
// ONE bounded, server-filtered GOVERNED read: listWorkOrders { equipmentId } over the EOS route
// (services/workOrderService.ts), refreshed -- never a Firestore query. `truncated` says when the asset
// has more Work Orders than the bounded page (200); the history must then not claim completeness.
//
// Service History is DERIVED from these (§10) -- there is no separate history ledger.
// `notActivated` is true while the Work Order authority answers NOT_ACTIVATED; `error` then carries the
// NOT_YET_ACTIVATED copy, never "no service history".
export function useWorkOrdersForEquipment(equipmentId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [notActivated, setNotActivated] = useState(false);

  useEffect(() => {
    if (!equipmentId) {
      setData([]);
      setError(null);
      setNotActivated(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const unsub = subscribeToWorkOrders(
      (workOrders) => {
        setData(workOrders);
        setError(null);
        setNotActivated(false);
        setLoading(false);
      },
      (err) => {
        // Fail closed: an empty history is honest; a partial one is a lie about an
        // asset's service record.
        setData([]);
        setNotActivated(err?.code === "NOT_ACTIVATED");
        setError(loadErrorMessage(err, { entity: "work orders" }));
        setLoading(false);
      },
      { filters: { equipmentId }, onTruncated: setTruncated },
    );

    return () => unsub();
  }, [equipmentId]);

  return { data, loading, error, truncated, notActivated };
}

// One register record, its installed unit and its history (the detail surface).
export function useEquipmentDoc(equipmentId, { client } = {}) {
  const { value, loading, error } = useRegisterRead("readEquipment", { equipmentId }, Boolean(equipmentId),
    (r) => ({ equipment: toEquipmentView(r.equipment), installedUnit: r.installedUnit ?? null, events: r.events ?? [] }), client);
  return { equipment: value?.equipment ?? null, installedUnit: value?.installedUnit ?? null, events: value?.events ?? [], loading, error };
}

// The Equipment of ONE Work Order -- the server answers for a register reader, or for the Technician ASSIGNED to it.
export function useWorkOrderEquipment(workOrderId, { client } = {}) {
  const { value, loading, error } = useRegisterRead("readWorkOrderEquipment", { workOrderId }, Boolean(workOrderId),
    (r) => ({ equipment: toEquipmentView(r.equipment), installedUnit: r.installedUnit ?? null }), client);
  return { equipment: value?.equipment ?? null, installedUnit: value?.installedUnit ?? null, loading, error };
}
