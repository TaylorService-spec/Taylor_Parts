// The ONLY client path that brings an already-owned unit onto the books.
//
// `serialized_assets` is deny-all to every client, so there is no client-direct alternative to fall
// back to, by design — an acquisition is a trusted write or it does not happen. This calls the
// trusted writer and returns what it said.
//
// Errors are RETURNED rather than thrown so the caller can branch on the CODE. Three of them are
// states worth showing rather than exceptions worth swallowing:
//
//   PART_NOT_SERIALIZED      the Part is real and the wrong KIND. "Not found" would send somebody
//                            hunting for a Part sitting in front of them.
//   LOCATION_INVALID         the place named is not an active company location — and a customer's
//                            location can never be one, which is what keeps acquisition from
//                            becoming installation by another name.
//   ALREADY_EXISTS_CONFLICT  a unit with that serial already exists for this part, recorded
//                            differently — possibly from a RECEIPT, which acquisition must never
//                            overwrite. Retrying cannot help and the UI must not offer it.
//
// A REPLAY IS NOT AN ERROR. The command derives identity from part+serial, so the same unit
// submitted twice returns `outcome: "replayed"` through the SUCCESS path. The caller presents that
// as completion, not as a second acquisition.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const ACQUIRE_CALLABLE = "acquireSerializedAsset";

export async function callAcquireSerializedAsset(request, deps = {}) {
  const call = deps.call ?? ((data) => httpsCallable(functions, ACQUIRE_CALLABLE)(data));
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
