// EMPLOYEE > FUNCTIONAL ROLES -- the Employee's business responsibilities (migration 1762819200000).
//
//   read     listEmployeeFunctionalRoles (employee.record.read): current, scheduled and past assignments
//   assign   assignEmployeeFunctionalRole { employeeId, functionalRoleId, reason, effectiveFrom? }
//   end      endEmployeeFunctionalRoleAssignment { employeeId, assignmentId, reason, effectiveTo? }
//            -- both admin.employeeFunctionalRole.write, re-checked by the Workforce service.
//
// A FUNCTIONAL ROLE GRANTS NOTHING. It is not a Security Role and not a Job Role; in a workflow it can only NARROW an
// action a Security Role capability already authorizes. The controls are OFFERED only to callers the Workforce
// capability read says hold the write capability; the server decides, and its refusal is shown verbatim
// (e.g. FUNCTIONAL_ROLE_SELF_ASSIGNMENT, FUNCTIONAL_ROLE_INACTIVE). No client authority logic.
import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import { statedReason } from "./controlPlaneModel.js";
import { ReasonField } from "./GrantControls.jsx";
import { workforceRefusal } from "./EmployeeWorkAuthorization.jsx";

export const FUNCTIONAL_ROLE_WRITE_CAPABILITY = "admin.employeeFunctionalRole.write";

/** A datetime-local value as an ISO instant, or undefined when empty ("now" -- the server's default). */
export function instantFrom(localValue) {
  if (typeof localValue !== "string" || localValue.trim() === "") return undefined;
  const at = new Date(localValue);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

const STATE_TAG = Object.freeze({
  CURRENT: "fo-cp-tag fo-cp-tag--allowed",
  SCHEDULED: "fo-cp-tag fo-cp-tag--conditional",
  ENDED: "fo-cp-tag",
});

export default function EmployeeFunctionalRoles({ employeeId, workforce, canWrite, onChanged }) {
  const read = useWorkforceRead("listEmployeeFunctionalRoles", employeeId ? { employeeId } : null, { client: workforce });
  const catalog = useWorkforceRead("listFunctionalRoles", canWrite && employeeId ? { status: "ACTIVE" } : null, { client: workforce });
  const [functionalRoleId, setFunctionalRoleId] = useState("");
  const [when, setWhen] = useState("");
  const [ending, setEnding] = useState(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const data = read.status === WORKFORCE_READ_STATE.READY ? read.data : null;
  const live = data ? [...(Array.isArray(data.current) ? data.current : []), ...(Array.isArray(data.scheduled) ? data.scheduled : [])] : null;
  const history = data && Array.isArray(data.items) ? data.items : [];
  const heldIds = new Set((live ?? []).map((i) => i.functionalRoleId));
  const offered = catalog.status === WORKFORCE_READ_STATE.READY && Array.isArray(catalog.data?.items)
    ? catalog.data.items.filter((r) => !heldIds.has(r.functionalRoleId))
    : [];
  const reasonText = statedReason(reason);

  const run = async (operation, input) => {
    const result = await Promise.resolve(workforce.call(operation, input)).catch(() => ({ ok: false, code: "UNREACHABLE", message: "the Workforce service could not be reached" }));
    setOutcome(result);
    if (result?.ok) { setFunctionalRoleId(""); setWhen(""); setEnding(null); setReason(""); read.reload(); onChanged?.(); }
  };

  return (
    <RuledSection title="Functional Roles" meta="Business responsibilities — not access">
      <p className="fo-muted">
        A Functional Role is what this Employee is responsible for. It is not a Security Role or a Job Role and grants
        nothing; a workflow may require one in addition to a Security Role.
      </p>
      {read.status === WORKFORCE_READ_STATE.LOADING ? <p className="fo-muted">Reading Functional Roles…</p> : null}
      {read.status === WORKFORCE_READ_STATE.FAILED ? <p className="fo-warning" role="alert">{workforceRefusal(read.error)}</p> : null}
      {live ? (
        live.length === 0 ? <p className="fo-muted">No current or scheduled Functional Role.</p> : (
          <ul className="fo-role-list" data-functional-roles={live.length}>
            {live.map((i) => (
              <li key={i.assignmentId} data-functional-role={i.key}>
                <span className={STATE_TAG[i.state] ?? "fo-cp-tag"}>{i.state}</span>{" "}
                <span>{i.name}</span>{" "}
                <span className="fo-muted"><code>{i.key}</code>{` · from ${i.effectiveFrom}`}{i.effectiveTo ? ` · until ${i.effectiveTo}` : ""}</span>{" "}
                {canWrite && !i.effectiveTo ? (
                  <Button type="button" variant="secondary" onClick={() => { setEnding(i); setReason(""); setWhen(""); setOutcome(null); }} aria-label={`End ${i.key}`}>End</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {live && canWrite ? (
        <form
          className="fo-cp-form"
          aria-label={ending ? "End Functional Role" : "Assign Functional Role"}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reasonText) return;
            const at = instantFrom(when);
            if (ending) {
              run("endEmployeeFunctionalRoleAssignment", { employeeId, assignmentId: ending.assignmentId, reason: reasonText, ...(at ? { effectiveTo: at } : {}) });
            } else if (functionalRoleId) {
              run("assignEmployeeFunctionalRole", { employeeId, functionalRoleId, reason: reasonText, ...(at ? { effectiveFrom: at } : {}) });
            }
          }}
        >
          {ending ? <p>{`End ${ending.name} (${ending.key})?`}</p> : (
            <label className="fo-form-field">
              <span>Functional Role</span>
              <select aria-label="Functional Role to assign" value={functionalRoleId} onChange={(e) => setFunctionalRoleId(e.target.value)}>
                <option value="">Choose…</option>
                {offered.map((r) => <option key={r.functionalRoleId} value={r.functionalRoleId}>{`${r.name} (${r.key})`}</option>)}
              </select>
            </label>
          )}
          <label className="fo-form-field">
            <span>{ending ? "Effective to (empty = now)" : "Effective from (empty = now)"}</span>
            <input type="datetime-local" aria-label={ending ? "Effective to" : "Effective from"} value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <ReasonField value={reason} onChange={setReason} />
          <div className="fo-btn-row">
            <Button type="submit" variant="primary" disabled={!reasonText || (!ending && !functionalRoleId)}>{ending ? "Confirm end" : "Assign"}</Button>
            {ending ? <Button type="button" variant="secondary" onClick={() => setEnding(null)}>Cancel</Button> : null}
          </div>
        </form>
      ) : null}
      {live && !canWrite ? <p className="fo-muted">Changing Functional Roles is offered to holders of {FUNCTIONAL_ROLE_WRITE_CAPABILITY}; the Workforce service re-checks it.</p> : null}
      {outcome ? (outcome.ok
        ? <p className="fo-muted" role="status">Saved by the server; re-reading.</p>
        : <p className="fo-warning" role="alert" data-functional-role-refusal={outcome.reason ?? outcome.code}>{workforceRefusal(outcome)}</p>) : null}
      {history.length > 0 ? (
        <details data-functional-role-history={history.length}>
          <summary>{`History (${history.length})`}</summary>
          <table className="fo-table" aria-label="Functional Role history">
            <thead><tr><th>Functional Role</th><th>State</th><th>From</th><th>To</th><th>Reason</th></tr></thead>
            <tbody>
              {history.map((i) => (
                <tr key={i.assignmentId}>
                  <td>{i.name} <span className="fo-muted"><code>{i.key}</code></span></td>
                  <td>{i.state}</td>
                  <td className="fo-muted">{i.effectiveFrom}</td>
                  <td className="fo-muted">{i.effectiveTo ?? "—"}</td>
                  <td className="fo-muted">{i.reason}{i.endReason ? ` · ended: ${i.endReason}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </RuledSection>
  );
}
