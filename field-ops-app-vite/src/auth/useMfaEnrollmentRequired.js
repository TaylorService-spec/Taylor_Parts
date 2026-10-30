import { useSyncExternalStore } from "react";
import { eosLoginClient } from "./eosLoginClient.js";

/** True while the signed-in EOS human session owes a second factor (see MfaEnrollmentGate). Reads the in-memory session only. */
export function useMfaEnrollmentRequired() {
  return useSyncExternalStore(
    eosLoginClient.subscribe,
    () => eosLoginClient.currentSession()?.mfaEnrollmentRequired === true,
    () => false,
  );
}
