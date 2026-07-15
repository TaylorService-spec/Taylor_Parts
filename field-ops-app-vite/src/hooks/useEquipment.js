import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { EQUIPMENT_COLLECTION } from "../domain/constants";
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
