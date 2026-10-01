import { useEffect, useState } from "react";
import { catalogApiClient } from "../services/catalogApiClient.js";
import { equipmentApiClient } from "../services/equipmentApiClient.js";

// The two governed CHOICES an Equipment register form states (Controller EQUIPMENT ACTIVATION, 2026-10-01): the
// operating company of a create, and the optional catalog Equipment Model. Kept apart from the register reads so a
// surface that only reads Equipment never loads either.

// The governed operating-company choice a register create states (equipment.record.manage).
export function useEquipmentOperatingCompanies(enabled = true, { client = equipmentApiClient } = {}) {
  const [state, setState] = useState({ options: [], error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    client.call("listEquipmentOperatingCompanies", {}).then((res) => {
      if (!live) return;
      setState(res?.ok ? { options: res.result?.items ?? [], error: null }
        : { options: [], error: "The operating companies could not be loaded; nothing can be added until they are." });
    });
    return () => { live = false; };
  }, [enabled, client]);
  return state;
}

// The catalog Equipment Models a register record may name (the governed catalog read; optional on the form).
export function useEquipmentModelOptions(enabled = true, { client = catalogApiClient } = {}) {
  const [state, setState] = useState({ options: [], error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    client.call("listEquipmentModels", {}).then((res) => {
      if (!live) return;
      if (!res?.ok) { setState({ options: [], error: "Catalog models could not be loaded; a model can be added later." }); return; }
      const models = Array.isArray(res.result?.models) ? res.result.models : [];
      setState({ error: null, options: models.filter((m) => m && typeof m.id === "string" && m.status === "ACTIVE")
        .map((m) => ({ id: m.id, label: m.displayName || m.modelNumber || m.id })) });
    });
    return () => { live = false; };
  }, [enabled, client]);
  return state;
}
