// The transport for the CRM write commands.
//
// WHAT THIS FILE MAY NOT DO. It never sends createdAt, createdBy, updatedAt, updatedBy or an id.
// Those are the SERVER's answers: it resolves the actor from request.auth.uid and stamps its own
// clock, and it strips those keys from any payload that carries them anyway. Sending one would be
// a browser attributing a change to someone else or backdating a record.
//
// THROWS, rather than resolving an outcome. The three domain modules it serves already throw on a
// failed write and their surfaces depend on it -- an edit form that swallowed a rejection would
// close as though the change had saved.
import { isWriteBlocked } from "../config/env";

async function invoke(name, payload) {
  // Lazy, matching every other trusted-command client here: firebase/firebase.js runs initializeApp
  // on import, so a static import would give this module an import-time side effect.
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  try {
    const res = await httpsCallable(functions, name)(payload);
    return res?.data ?? null;
  } catch (err) {
    // httpsCallable prefixes its codes; stripped so callers that already branch on a bare
    // "permission-denied" keep working.
    const raw = typeof err?.code === "string" ? err.code : "";
    const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
    const normalized = new Error(err?.message ?? `${name} failed`);
    normalized.code = code;
    // The governed-field refusal carries its own domain code so a surface can say WHY rather than
    // rendering a generic denial for an edit the person may repeat without the two fields.
    normalized.detail = err?.details?.code ?? null;
    throw normalized;
  }
}

/** The demo/panic write gate, checked before the round trip exactly as the store did. */
function blocked(label, id) {
  if (!isWriteBlocked()) return null;
  console.warn(`WRITE BLOCKED (${label})`, id ?? "");
  return { blocked: true };
}

export async function submitCreateAccount(data) {
  return blocked("createAccount") ?? invoke("createAccountRecord", { data });
}

export async function submitUpdateAccount(id, data) {
  return blocked("updateAccount", id) ?? invoke("updateAccountRecord", { id, data });
}

export async function submitCreateContact(accountId, data) {
  return blocked("createContact") ?? invoke("createContactRecord", { accountId, data });
}

export async function submitUpdateContact(id, data) {
  return blocked("updateContact", id) ?? invoke("updateContactRecord", { id, data });
}

export async function submitCreateLocation(accountId, data) {
  return blocked("createLocation") ?? invoke("createLocationRecord", { accountId, data });
}

export async function submitUpdateLocation(id, data) {
  return blocked("updateLocation", id) ?? invoke("updateLocationRecord", { id, data });
}
