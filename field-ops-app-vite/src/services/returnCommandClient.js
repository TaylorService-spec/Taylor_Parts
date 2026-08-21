// Return intake -- thin httpsCallable transport. Structure mirrors services/binCommandClient.js:
// it builds nothing, it just invokes the named onCall export.
//
// `inventory.returns.intake` is registered `active: false` in the catalog and activated only for
// platform-sandbox, so outside that environment every real call resolves `permission-denied`
// server-side. This client does not hide that; the surface renders a refusal as a refusal, never as
// a fabricated success and never as "no returns".
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const RETURN_CALLABLES = Object.freeze({
  intake: "recordReturnIntake",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const returnCommandClient = Object.freeze({
  recordReturnIntake: (request) => call(RETURN_CALLABLES.intake, request),
});
