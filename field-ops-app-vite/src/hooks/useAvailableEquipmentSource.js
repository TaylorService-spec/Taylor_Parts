import { useEffect, useRef, useState } from "react";
import { callEquipmentApi, EQUIPMENT_LIST_MAX } from "../services/equipmentApiClient.js";
import { SERIALIZED_ASSET_SOURCE_STATUS } from "../access/serializedAssetSource.js";

// One-shot read of the company-held whole units available to install -- the GOVERNED EOS read
// (/operations/equipment listAvailableEquipmentUnits, inventory.serializedAsset.read; Controller EQUIPMENT ACTIVATION,
// 2026-10-01), never the Firebase getAvailableEquipment callable. Resolved into the SAME { connected, status, assets }
// envelope access/serializedAssetSource.js defines, so the consuming component's state derivation
// (domain/availableEquipmentCatalogView.js) is unchanged. A refused read is DENIED, a failed one UNAVAILABLE -- never an
// empty list pretending there is nothing in stock.
export function toAvailableAsset(u) {
  return Object.freeze({
    serialNo: u.serialNumber,
    partId: u.partId,
    currentEquipmentId: null,
    availableForAssignment: u.status === "AVAILABLE",
    status: u.status ?? null,
    location: u.locationId ?? null,
    locationLabel: u.binCode ? [u.warehouseName, u.binCode].filter(Boolean).join(" / ") : (u.warehouseName ?? null),
  });
}

export function useAvailableEquipmentSource({ call = callEquipmentApi } = {}) {
  const [state, setState] = useState({ status: SERIALIZED_ASSET_SOURCE_STATUS.LOADING, assets: [] });
  // ONE read per mount: the transport is held, not a dependency, so a caller passing a fresh function never re-reads.
  const callRef = useRef(call);

  useEffect(() => {
    let cancelled = false;
    setState({ status: SERIALIZED_ASSET_SOURCE_STATUS.LOADING, assets: [] });
    callRef.current("listAvailableEquipmentUnits", { limit: EQUIPMENT_LIST_MAX }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setState({
          status: res.code === "FORBIDDEN" ? SERIALIZED_ASSET_SOURCE_STATUS.DENIED : SERIALIZED_ASSET_SOURCE_STATUS.UNAVAILABLE,
          assets: [],
        });
        return;
      }
      setState({ status: SERIALIZED_ASSET_SOURCE_STATUS.READY, assets: (res.result?.units ?? []).map(toAvailableAsset) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    connected: state.status === SERIALIZED_ASSET_SOURCE_STATUS.READY,
    status: state.status,
    assets: state.assets,
  };
}
