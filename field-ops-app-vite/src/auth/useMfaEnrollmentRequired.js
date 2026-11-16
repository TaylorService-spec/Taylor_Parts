import { useSyncExternalStore } from "react";
import { eosLoginClient } from "./eosLoginClient.js";

/** The one condition App shows MfaEnrollmentGate on: a signed-in user whose session owes a second factor. */
export const mfaGateActive = (required, user) => required === true && Boolean(user);

/** True while the signed-in EOS human session owes a second factor (see MfaEnrollmentGate). Reads the in-memory session only. */
export function useMfaEnrollmentRequired() {
  return useSyncExternalStore(
    eosLoginClient.subscribe,
    () => eosLoginClient.currentSession()?.mfaEnrollmentRequired === true,
    () => false,
  );
}
