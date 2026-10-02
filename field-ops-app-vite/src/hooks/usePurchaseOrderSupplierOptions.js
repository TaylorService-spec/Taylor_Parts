import { useEffect, useState } from "react";
import { fetchPurchaseOrderSupplierOptions } from "../services/partsOperationsReads.js";

// DECISIONS #193 -- the governed supplier SELECTION for one Reorder's new Purchase Order: ACTIVE suppliers plus the OTHER
// operating companies, by name (the server excludes the buying company and never offers CONSOLIDATED). Same state contract
// as useSuppliers ({ loading, error, suppliers }) so the existing SupplierPicker renders it unchanged. Fail-closed: a denied
// or unavailable read is an error code, never a partial list and never a free-text fallback.
export function usePurchaseOrderSupplierOptions(reorderRequestId, accessVersion) {
  const [state, setState] = useState({ loading: true, error: null, suppliers: [] });

  useEffect(() => {
    let cancelled = false;
    if (!reorderRequestId) {
      setState({ loading: false, error: "invalid-argument", suppliers: [] });
      return undefined;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchPurchaseOrderSupplierOptions(reorderRequestId)
      .then((items) => { if (!cancelled) setState({ loading: false, error: null, suppliers: items }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err?.code ?? "unknown", suppliers: [] }); });
    return () => { cancelled = true; };
  }, [reorderRequestId, accessVersion]);

  return state;
}
