// The transport for the Equipment write commands.
//
// Shaped to match what the pure core (domain/equipmentWrites.js) expects from an injected store:
// `add(data)` and `update(id, data)` resolving to the saved record, returning a `{ blocked: true }`
// sentinel when the platform write gate is closed, and THROWING otherwise. That contract is why the
// core's rules stayed provable under plain node, and it is preserved rather than rewritten.
//
// WHAT THIS FILE NEVER SENDS. No actor, no timestamp, no permission decision, no `before` as
// evidence, and no Location object. The server resolves the actor from request.auth.uid, stamps its
// own clock, loads its own stored Equipment, and reads `locations/{locationId}` itself to prove
// ownership. A browser holding a Location document is holding a copy, not proof.
import { isWriteBlocked } from "../config/env";

async function invoke(name, payload) {
  // Lazy, like every other trusted-command client here: firebase/firebase.js runs initializeApp on
  // import, so a static import would give this module an import-time side effect.
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  try {
    const res = await httpsCallable(functions, name)(payload);
    return res?.data?.equipment ?? null;
  } catch (err) {
    // The DOMAIN CODE is preserved on the error so the core's own error mapper can keep telling a
    // person the right thing -- "retiring isn't available here" is a different sentence from "check
    // the highlighted fields", and collapsing them would make the screen less honest than it is.
    const raw = typeof err?.code === "string" ? err.code : "";
    const normalized = new Error(err?.message ?? `${name} failed`);
    normalized.code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
    normalized.detail = err?.details?.code ?? null;
    throw normalized;
  }
}

export async function submitCreateEquipment(values) {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (createEquipment)");
    return { blocked: true };
  }
  return invoke("createEquipmentRecord", { values });
}

export async function submitUpdateEquipment(id, values) {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (updateEquipment)", id);
    return { blocked: true };
  }
  return invoke("updateEquipmentRecord", { id, values });
}
