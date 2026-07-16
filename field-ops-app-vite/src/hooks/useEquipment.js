import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { EQUIPMENT_COLLECTION, WORK_ORDERS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";

// Issue #232 unit E2 -- the Equipment read path.
//
// Three scoped listeners, following the useLocationsForAccount() / useAccount()
// precedent rather than modifying the generic useFirestoreCollection(). Each one is a
// SINGLE bounded query -- never an unbounded collection read, and never a per-record
// loop (no query-per-row): an Account's or Location's equipment arrives in one
// server-side filtered subscription. Both are single-field equality queries, so
// neither needs a composite index.
//
// Unlike the older read hooks these also return a safe `error` string. E2 requires a
// failed read to be reportable without leaking a Firebase code, path, or document id,
// so the onSnapshot error callback maps through loadErrorMessage() -- the same
// discipline the write path uses via equipmentSaveErrorMessage(). Until E3's Rules are
// deployed these subscriptions are expected to fail permission-denied in production
// and will surface as "You do not have permission to view this equipment."

const ENTITY = "equipment";

// Bounded Account-scoped query: the equipment installed anywhere at one customer.
export function useEquipmentForAccount(accountId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!accountId) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const q = query(collection(db, EQUIPMENT_COLLECTION), where("accountId", "==", accountId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        // Fail closed: surface nothing rather than a stale/partial list.
        setData([]);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accountId]);

  return { data, loading, error };
}

// Bounded Location-scoped query: the equipment installed at one location.
export function useEquipmentForLocation(locationId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!locationId) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const q = query(collection(db, EQUIPMENT_COLLECTION), where("locationId", "==", locationId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        setData([]);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      }
    );

    return () => unsub();
  }, [locationId]);

  return { data, loading, error };
}

// Issue #232 unit E7 -- the Work Orders linked to ONE piece of equipment, for the
// detail page's linked-Work-Orders section and its derived Service History (§10).
//
// A single bounded, server-filtered query on equipmentId. Deliberately NOT
// useWorkOrders(), which subscribes to the entire collection: pulling every Work Order
// in the business to show one asset's history would be an unbounded read to render a
// handful of rows. Single-field equality, so no composite index is required.
//
// Service History is DERIVED from these (§10) -- there is no separate history ledger --
// so this hook is the only source, and equipmentServiceHistory()/groupServiceHistoryBy
// Year() shape it purely, client-side, over this already-bounded set.
export function useWorkOrdersForEquipment(equipmentId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!equipmentId) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const q = query(collection(db, WORK_ORDERS_COLLECTION), where("equipmentId", "==", equipmentId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        // Fail closed: an empty history is honest; a partial one is a lie about an
        // asset's service record.
        setData([]);
        setError(loadErrorMessage(err, { entity: "work orders" }));
        setLoading(false);
      }
    );

    return () => unsub();
  }, [equipmentId]);

  return { data, loading, error };
}

// Single-document live subscription for the detail surface (E7).
export function useEquipmentDoc(equipmentId) {
  const [equipment, setEquipment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!equipmentId) {
      setEquipment(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, EQUIPMENT_COLLECTION, equipmentId),
      (snap) => {
        setEquipment(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setEquipment(null);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      }
    );

    return () => unsub();
  }, [equipmentId]);

  return { equipment, loading, error };
}
