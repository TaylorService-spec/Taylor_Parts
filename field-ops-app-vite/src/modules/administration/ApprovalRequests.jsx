import { useCallback, useEffect, useState } from "react";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { privilegedApprovalClient } from "../../services/privilegedApprovalClient.js";

// ADMINISTRATION > ROLES & PERMISSIONS > APPROVAL REQUESTS
//
// ============================ WHY THIS SCREEN EXISTS ============================
//
// A privileged Role grant now requires an APPROVAL from an authenticated Admin session. That
// control was built with no way to exercise it, which meant the only route to an approval was a
// Node script or a raw callable invocation -- an operator being asked to do governance work outside
// the product that governs it. An approval nobody can perform through EOS is a control the business
// will route around.
//
// ============================ THE UI IS NOT THE AUTHORITY ============================
//
// Everything here is convenience. The callable authorizes every request server-side, the approving
// identity is `request.auth.uid`, and this component never sends an approver. Hiding a button stops
// a mistake; it does not stop an attacker, and it is not relied on to.
//
// A load failure therefore renders as "you cannot see this queue" rather than "there is nothing
// pending" -- an empty list and a refused read look identical and mean opposite things.

const DECISION = Object.freeze({ APPROVE: "APPROVE", REJECT: "REJECT" });

function formatWhen(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

/** Business-language Role label. Falls back to the id rather than rendering a blank. */
function roleLabel(roleId) {
  const LABELS = { owner: "Owner", admin: "Administrator" };
  return LABELS[roleId] || roleId;
}

function scopeLabel(scope) {
  if (!scope || typeof scope !== "object") return "—";
  return scope.type === "global" ? "Global" : String(scope.type);
}

export default function ApprovalRequests({ onPendingCountChange }) {
  const [requests, setRequests] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [errorText, setErrorText] = useState("");
  const [confirming, setConfirming] = useState(null); // { request, decision }
  const [busyRequestId, setBusyRequestId] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorText("");
    try {
      const rows = await privilegedApprovalClient.listAll();
      setRequests(rows);
      setLoadState("ready");
      const pending = rows.filter((r) => r.status === "PENDING_APPROVAL").length;
      if (onPendingCountChange) onPendingCountChange(pending);
    } catch (err) {
      // DENIED AND EMPTY MUST NOT LOOK THE SAME. An administrator seeing "no pending requests"
      // when the read was refused would conclude there is nothing to approve.
      setLoadState("denied");
      setErrorText(err?.message || "This queue is not available to your account.");
      if (onPendingCountChange) onPendingCountChange(0);
    }
  }, [onPendingCountChange]);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (request, decision) => {
    setBusyRequestId(request.requestId);
    setNotice("");
    try {
      await privilegedApprovalClient.decide({ requestId: request.requestId, decision });
      // Re-read from the server rather than patching local state. The decision's real outcome --
      // including whether it was a no-op replay -- lives server-side, and rendering an optimistic
      // "APPROVED" would be the UI asserting something it did not verify.
      await load();
      setNotice(
        decision === DECISION.APPROVE
          ? `Approved ${roleLabel(request.roleId)} access for ${request.displayName || request.principalUid}.`
          : `Rejected the ${roleLabel(request.roleId)} request for ${request.displayName || request.principalUid}.`,
      );
    } catch (err) {
      setNotice(err?.message || "The decision could not be recorded.");
    } finally {
      setBusyRequestId(null);
      setConfirming(null);
    }
  }, [load]);

  const pending = requests.filter((r) => r.status === "PENDING_APPROVAL");
  const decided = requests.filter((r) => r.status !== "PENDING_APPROVAL");

  if (loadState === "loading") {
    return <p className="fo-muted">Loading approval requests…</p>;
  }

  if (loadState === "denied") {
    return (
      <div className="fo-card">
        <StatusPill tone="attention" label="Not available" asText />
        <p className="fo-muted">
          {errorText} Approving a privileged Role requires security administration authority.
        </p>
      </div>
    );
  }

  return (
    <div className="fo-approval-requests">
      {notice && <p className="fo-approval-notice" role="status">{notice}</p>}

      <h3>
        Pending approval{" "}
        {pending.length > 0 && <StatusPill tone="attention" label={String(pending.length)} asText />}
      </h3>

      {pending.length === 0 ? (
        <p className="fo-muted">No privileged Role requests are waiting for a decision.</p>
      ) : (
        <ul className="fo-approval-list">
          {pending.map((r) => (
            <li key={r.requestId} className="fo-card fo-approval-item">
              <div className="fo-approval-item__detail">
                <strong>{r.displayName || "(unnamed principal)"}</strong>
                <dl className="fo-approval-facts">
                  <div><dt>Target principal</dt><dd><code>{r.principalUid}</code></dd></div>
                  <div><dt>Requested Role</dt><dd>{roleLabel(r.roleId)}</dd></div>
                  <div><dt>Scope</dt><dd>{scopeLabel(r.scope)}</dd></div>
                  <div><dt>Requested</dt><dd>{formatWhen(r.requestedAtMs)}</dd></div>
                  <div><dt>Proposed by</dt><dd><code>{r.requestedBy}</code></dd></div>
                  <div><dt>Status</dt><dd><StatusPill tone="attention" label="Pending approval" asText /></dd></div>
                </dl>
              </div>
              <div className="fo-approval-item__actions">
                <Button
                  onClick={() => setConfirming({ request: r, decision: DECISION.APPROVE })}
                  disabled={busyRequestId === r.requestId}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirming({ request: r, decision: DECISION.REJECT })}
                  disabled={busyRequestId === r.requestId}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <>
          <h3>Decided</h3>
          <ul className="fo-approval-list">
            {decided.map((r) => (
              <li key={r.requestId} className="fo-card fo-approval-item">
                <div className="fo-approval-item__detail">
                  <strong>{r.displayName || r.principalUid}</strong>
                  <dl className="fo-approval-facts">
                    <div><dt>Role</dt><dd>{roleLabel(r.roleId)}</dd></div>
                    <div><dt>Scope</dt><dd>{scopeLabel(r.scope)}</dd></div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <StatusPill
                          tone={r.status === "APPROVED" ? "positive" : "neutral"}
                          label={r.status === "APPROVED" ? "Approved" : "Rejected"}
                          asText
                        />
                      </dd>
                    </div>
                    <div><dt>Decided by</dt><dd><code>{r.decidedBy || "—"}</code></dd></div>
                    <div><dt>Decided</dt><dd>{formatWhen(r.decidedAtMs)}</dd></div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {confirming && (
        // EXPLICIT CONFIRMATION. A privileged elevation is not an action to complete on one click,
        // and the confirmation restates WHO and WHAT rather than asking "are you sure?" -- the
        // question that gets answered yes without being read.
        <div className="fo-approval-confirm" role="dialog" aria-modal="true" aria-label="Confirm decision">
          <div className="fo-card fo-approval-confirm__panel">
            <h4>
              {confirming.decision === DECISION.APPROVE
                ? `Approve ${roleLabel(confirming.request.roleId)} access for ${confirming.request.displayName || confirming.request.principalUid}?`
                : `Reject the ${roleLabel(confirming.request.roleId)} request for ${confirming.request.displayName || confirming.request.principalUid}?`}
            </h4>
            <dl className="fo-approval-facts">
              <div><dt>Role</dt><dd>{roleLabel(confirming.request.roleId)}</dd></div>
              <div><dt>Scope</dt><dd>{scopeLabel(confirming.request.scope)}</dd></div>
            </dl>
            {confirming.decision === DECISION.APPROVE && (
              <p className="fo-muted">
                This grants the Role immediately and is recorded against your signed-in account.
              </p>
            )}
            <div className="fo-approval-confirm__actions">
              <Button
                onClick={() => decide(confirming.request, confirming.decision)}
                disabled={busyRequestId === confirming.request.requestId}
              >
                {confirming.decision === DECISION.APPROVE ? "Approve" : "Reject"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
