import { useEffect, useState } from "react";
import { fetchAvailableEquipment } from "../services/serializedAssetReadCallableClient.js";
import { mapAvailableEquipmentProjectionToAssets } from "../domain/availableEquipmentGovernedProjection.js";
import { SERIALIZED_ASSET_SOURCE_STATUS } from "../access/serializedAssetSource.js";

// One-shot read of the governed Available Equipment projection (the REAL default source for
// modules/equipment/AvailableEquipment.jsx -- see access/serializedAssetSource.js's header). Own
// loading/error state (mirrors hooks/useManufacturerCatalog.js's shape), resolved into the SAME
// {connected, status, assets} envelope access/serializedAssetSource.js's inert default already used,
// so the consuming component's state-derivation logic (domain/availableEquipmentCatalogView.js) does
// not need to know whether it is reading a live or an injected source.
//
// `inventory.serializedAsset.read` is registered `active:false` (access/permissionCatalog.ts), which
// is the PRODUCTION posture. CORRECTED 2026-09-12 -- this comment used to say it was "granted to no
// Role as of this build" and that the read "fails closed with a DENIED status in every environment".
// modules/equipment/AvailableEquipment.jsx corrected exactly that pair in its own header and this
// copy of it was missed: thirteen governed business Roles hold the id (least-privilege
// inventoryLookupReader, access/governedBusinessRoles.ts) and it is ACTIVATED in platform-sandbox
// (config/environments.json). DENIED is one of the outcomes this hook must render honestly, not the
// condition of the surface: never fabricated inventory and never a silent fallback to the inert
// "registry doesn't exist" copy.
export function useAvailableEquipmentSource() {
  const [state, setState] = useState({ status: SERIALIZED_ASSET_SOURCE_STATUS.LOADING, assets: [] });

  useEffect(() => {
    let cancelled = false;
    setState({ status: SERIALIZED_ASSET_SOURCE_STATUS.LOADING, assets: [] });
    fetchAvailableEquipment().then(({ result, errorStatus }) => {
      if (cancelled) return;
      if (errorStatus) {
        setState({
          status: errorStatus === "denied" ? SERIALIZED_ASSET_SOURCE_STATUS.DENIED : SERIALIZED_ASSET_SOURCE_STATUS.UNAVAILABLE,
          assets: [],
        });
        return;
      }
      setState({ status: SERIALIZED_ASSET_SOURCE_STATUS.READY, assets: mapAvailableEquipmentProjectionToAssets(result) });
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
