// The CREDENTIAL behind a governed Principal -- for account (User Access) actions only.
//
// The legacy account and Role callables (readPrincipalAccessState, setUserStatus, assignApprovedRole, revokeRole,
// password reset) are keyed by the Firebase Auth uid: the CREDENTIAL. They are security concerns, not Employee
// business data. The uid is reached along the governed chain EMPLOYEE -> governed link (EMP-RT-02) -> PRINCIPAL ->
// (identity provider, external subject) from the Administration API's listTenantPrincipals -- never from an
// Employee document, and never the other way round (a uid never resolves an Employee here).
import { useEffect, useState } from "react";
import { callPolicyApi } from "../services/adminPolicyApiClient.js";

export const CREDENTIAL_STATE = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  RESOLVED: "resolved",
  UNRESOLVED: "unresolved",
  FAILED: "failed",
});

/** The identity provider whose external subject the legacy account callables accept. */
export const LEGACY_ACCOUNT_IDENTITY_PROVIDER = "firebase";

/** Pure: the credential subject for one Principal id out of a listTenantPrincipals result. */
export function credentialSubjectFor(principals, principalId) {
  if (!Array.isArray(principals) || !principalId) return null;
  const principal = principals.find((p) => p && p.id === principalId);
  if (!principal || principal.identityProvider !== LEGACY_ACCOUNT_IDENTITY_PROVIDER) return null;
  return typeof principal.externalSubject === "string" && principal.externalSubject.length > 0 ? principal.externalSubject : null;
}

export function usePrincipalCredential(principalId, { policyCall = callPolicyApi } = {}) {
  const [state, setState] = useState({ status: CREDENTIAL_STATE.IDLE, subject: null, error: null });
  useEffect(() => {
    if (!principalId) {
      setState({ status: CREDENTIAL_STATE.IDLE, subject: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ status: CREDENTIAL_STATE.LOADING, subject: null, error: null });
    Promise.resolve(policyCall("listTenantPrincipals", {}))
      .then((outcome) => {
        if (cancelled) return;
        if (!outcome || !outcome.ok) {
          setState({ status: CREDENTIAL_STATE.FAILED, subject: null, error: outcome ?? { code: "INTERNAL" } });
          return;
        }
        const subject = credentialSubjectFor(outcome.data, principalId);
        setState({ status: subject ? CREDENTIAL_STATE.RESOLVED : CREDENTIAL_STATE.UNRESOLVED, subject, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: CREDENTIAL_STATE.FAILED, subject: null, error: { code: "INTERNAL" } });
      });
    return () => {
      cancelled = true;
    };
  }, [principalId, policyCall]);
  return state;
}
