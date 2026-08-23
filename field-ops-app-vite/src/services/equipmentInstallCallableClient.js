// The ONLY client path that installs a unit at a customer.
//
// `serialized_assets` is deny-all to every client, and the link between an asset and its Equipment
// cannot be written from a browser at all -- so there is no client-direct alternative to fall back
// to, by design. This calls the trusted writer and returns what it said.
//
// Errors are returned rather than thrown so the caller can branch on the CODE. ALREADY_INSTALLED is
// a state worth showing, not an exception worth swallowing.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const INSTALL_CALLABLE = "installSerializedAsset";

export async function callInstallSerializedAsset(request, deps = {}) {
  const call = deps.call ?? ((data) => httpsCallable(functions, INSTALL_CALLABLE)(data));
  try {
    const res = await call(request);
    return { outcome: res?.data ?? null, error: null };
  } catch (err) {
    return {
      outcome: null,
      // firebase-functions puts the command's own failure code in `details`; `code` is the HTTPS
      // status. Both are carried so the caller can branch on the specific one and fall back to the
      // general one.
      error: { code: err?.code ?? null, details: err?.details ?? null, message: err?.message ?? null },
    };
  }
}
