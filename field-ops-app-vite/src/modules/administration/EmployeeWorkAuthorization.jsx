// EMPLOYEE > WORK ELIGIBILITY and OPERATIONAL SCOPE -- two independent Workforce facts, each its own section.
//
//   Work Eligibility   "is this Employee QUALIFIED for this kind of work?"   listEmployeeWorkEligibility,
//                      assignEmployeeWorkEligibility / endEmployeeWorkEligibility (admin.employeeWorkEligibility.write)
//   Operational Scope  "WHERE does this Employee operationally work?"        listEmployeeOperationalScopes,
//                      assignEmployeeOperationalScope / endEmployeeOperationalScope (admin.employeeOperationalScope.write)
//                      Targets: listOperationalScopeTargets -- per scope type, this tenant's GOVERNED values (ACTIVE
//                      warehouses; ACTIVE operating company keys for a Reorder Queue). The picker offers ONLY those;
//                      there is no typed scope id, and a type with no governed value is shown unavailable with the
//                      server's reason (lane GA).
//
// Both are governed PostgreSQL commands on the Workforce transport, audited server-side. NEITHER IS A
// SECURITY GRANT: they are facts a grant CONDITION may test (WORK_ELIGIBILITY / OPERATIONAL_SCOPE), never
// access by themselves, and neither is derived from Job Role or a Security Role.
//
// The controls are OFFERED only to callers the Workforce capability read says hold the write capability --
// the SAME set the command re-checks -- which is convenience; the server's refusal is shown verbatim.
import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import { statedReason } from "./controlPlaneModel.js";
import { ReasonField } from "./GrantControls.jsx";

export const WORK_ELIGIBILITY_WRITE_CAPABILITY = "admin.employeeWorkEligibility.write";
export const OPERATIONAL_SCOPE_WRITE_CAPABILITY = "admin.employeeOperationalScope.write";

// The WORKFORCE vocabularies these two commands accept (workEligibilityVocabulary.ts and
// operationalScopeVocabulary.ts, both CHECK-constrained; the command re-validates). These are Employee
// facts, not the grant-condition vocabulary -- that one is the server's listSupportedConditionKinds.
const WORK_ELIGIBILITY_CODES = Object.freeze(["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS", "PARTS_OPERATIONS"]);

/** The server's scope-target vocabulary, or null. Nothing is invented when it is absent or unreadable. */
function scopeTargetsFrom(data) {
  return data && Array.isArray(data.scopeTypes) ? data.scopeTypes.filter((t) => t && typeof t.scopeType === "string") : null;
}

/** A Workforce refusal in the server's words: its category, its specific reason code, its message. */
export function workforceRefusal(outcome) {
  if (!outcome || outcome.ok) return null;
  return `${outcome.code ?? "INTERNAL"}${outcome.reason ? ` (${outcome.reason})` : ""}: ${outcome.message ?? "the request could not be completed"}`;
}

function WorkforceOutcome({ outcome }) {
  if (!outcome) return null;
  if (outcome.ok) return <p className="fo-muted" role="status">Saved by the server; re-reading.</p>;
  return <p className="fo-warning" role="alert">{workforceRefusal(outcome)}</p>;
}

function ReadFailure({ read, what }) {
  if (read.status === WORKFORCE_READ_STATE.LOADING) return <p className="fo-muted">{`Reading ${what}…`}</p>;
  if (read.status === WORKFORCE_READ_STATE.FAILED) return <p className="fo-warning" role="alert">{workforceRefusal(read.error)}</p>;
  return null;
}

export function WorkEligibilitySection({ employeeId, workforce, canWrite, onChanged }) {
  const read = useWorkforceRead("listEmployeeWorkEligibility", employeeId ? { employeeId } : null, { client: workforce });
  const [code, setCode] = useState("");
  const [ending, setEnding] = useState(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const items = read.status === WORKFORCE_READ_STATE.READY && Array.isArray(read.data?.items) ? read.data.items : null;
  const held = new Set((items ?? []).map((i) => i.qualificationCode));
  const reasonText = statedReason(reason);

  const run = async (operation, input) => {
    const result = await Promise.resolve(workforce.call(operation, input)).catch(() => ({ ok: false, code: "UNREACHABLE", message: "the Workforce service could not be reached" }));
    setOutcome(result);
    if (result?.ok) { setCode(""); setEnding(null); setReason(""); read.reload(); onChanged?.(); }
  };

  return (
    <RuledSection title="Work Eligibility" meta="Qualification for a kind of work — not access">
      <ReadFailure read={read} what="Work Eligibility" />
      {items ? (
        items.length === 0 ? <p className="fo-muted">No current Work Eligibility.</p> : (
          <ul className="fo-role-list" data-work-eligibility={items.length}>
            {items.map((i) => (
              <li key={i.qualificationId ?? i.qualificationCode}>
                <span>{i.label ?? i.qualificationCode}</span>{" "}
                <span className="fo-muted"><code>{i.qualificationCode}</code>{i.effectiveFrom ? ` · since ${i.effectiveFrom}` : ""}</span>{" "}
                {canWrite ? (
                  <Button type="button" variant="secondary" onClick={() => { setEnding(i); setReason(""); setOutcome(null); }} aria-label={`End ${i.qualificationCode}`}>End</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {items && canWrite ? (
        <form
          className="fo-cp-form"
          aria-label={ending ? "End Work Eligibility" : "Assign Work Eligibility"}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reasonText) return;
            if (ending) run("endEmployeeWorkEligibility", { employeeId, qualificationCode: ending.qualificationCode, reason: reasonText });
            else if (code) run("assignEmployeeWorkEligibility", { employeeId, qualificationCode: code, reason: reasonText });
          }}
        >
          {ending ? <p>{`End ${ending.label ?? ending.qualificationCode}?`}</p> : (
            <label className="fo-form-field">
              <span>Qualification</span>
              <select aria-label="Qualification to assign" value={code} onChange={(e) => setCode(e.target.value)}>
                <option value="">Choose…</option>
                {WORK_ELIGIBILITY_CODES.filter((c) => !held.has(c)).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <ReasonField value={reason} onChange={setReason} />
          <div className="fo-btn-row">
            <Button type="submit" variant="primary" disabled={!reasonText || (!ending && !code)}>{ending ? "Confirm end" : "Assign"}</Button>
            {ending ? <Button type="button" variant="secondary" onClick={() => setEnding(null)}>Cancel</Button> : null}
          </div>
        </form>
      ) : null}
      {items && !canWrite ? <p className="fo-muted">Changing Work Eligibility is offered to holders of {WORK_ELIGIBILITY_WRITE_CAPABILITY}; the Workforce service re-checks it.</p> : null}
      <WorkforceOutcome outcome={outcome} />
    </RuledSection>
  );
}

export function OperationalScopeSection({ employeeId, workforce, canWrite, onChanged }) {
  const read = useWorkforceRead("listEmployeeOperationalScopes", employeeId ? { employeeId } : null, { client: workforce });
  const targetsRead = useWorkforceRead("listOperationalScopeTargets", employeeId && canWrite ? {} : null, { client: workforce });
  const [scopeType, setScopeType] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [ending, setEnding] = useState(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const items = read.status === WORKFORCE_READ_STATE.READY && Array.isArray(read.data?.items) ? read.data.items : null;
  const reasonText = statedReason(reason);
  const targets = targetsRead.status === WORKFORCE_READ_STATE.READY ? scopeTargetsFrom(targetsRead.data) : null;
  const chosenType = targets?.find((t) => t.scopeType === scopeType) ?? null;
  const held = new Set((items ?? []).map((i) => `${i.scopeType}:${i.scopeId}`));
  const offered = (chosenType?.values ?? []).filter((v) => !held.has(`${scopeType}:${v.value}`));
  // Only a value the server offered for the chosen type can be submitted.
  const target = chosenType?.available && offered.some((v) => v.value === scopeId) ? scopeId : "";

  const run = async (operation, input) => {
    const result = await Promise.resolve(workforce.call(operation, input)).catch(() => ({ ok: false, code: "UNREACHABLE", message: "the Workforce service could not be reached" }));
    setOutcome(result);
    if (result?.ok) { setScopeType(""); setScopeId(""); setEnding(null); setReason(""); read.reload(); onChanged?.(); }
  };

  return (
    <RuledSection title="Operational Scope" meta="Where the Employee operationally works — not access">
      <ReadFailure read={read} what="Operational Scope" />
      {items ? (
        items.length === 0 ? <p className="fo-muted">No current Operational Scope.</p> : (
          <ul className="fo-role-list" data-operational-scope={items.length}>
            {items.map((i) => (
              <li key={i.operationalScopeId ?? `${i.scopeType}:${i.scopeId}`}>
                <span>{`${i.scopeTypeLabel ?? i.scopeType}: ${i.scopeName ?? i.scopeId}`}</span>{" "}
                <span className="fo-muted"><code>{i.scopeId}</code>{i.warehouseStatus && i.warehouseStatus !== "ACTIVE" ? ` · target ${i.warehouseStatus}` : ""}</span>{" "}
                {canWrite ? (
                  <Button type="button" variant="secondary" onClick={() => { setEnding(i); setReason(""); setOutcome(null); }} aria-label={`End scope ${i.scopeId}`}>End</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {items && canWrite ? (
        <form
          className="fo-cp-form"
          aria-label={ending ? "End Operational Scope" : "Assign Operational Scope"}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reasonText) return;
            if (ending) run("endEmployeeOperationalScope", { employeeId, scopeType: ending.scopeType, scopeId: ending.scopeId, reason: reasonText });
            else if (scopeType && target) run("assignEmployeeOperationalScope", { employeeId, scopeType, scopeId: target, reason: reasonText });
          }}
        >
          {ending ? <p>{`End ${ending.scopeTypeLabel ?? ending.scopeType} ${ending.scopeName ?? ending.scopeId}?`}</p> : (
            <ScopeTargetPicker
              targetsRead={targetsRead} targets={targets} scopeType={scopeType} scopeId={scopeId} chosenType={chosenType} offered={offered}
              onScopeType={(t) => { setScopeType(t); setScopeId(""); }} onScopeId={setScopeId}
            />
          )}
          <ReasonField value={reason} onChange={setReason} />
          <div className="fo-btn-row">
            <Button type="submit" variant="primary" disabled={!reasonText || (!ending && (!scopeType || !target))}>{ending ? "Confirm end" : "Assign"}</Button>
            {ending ? <Button type="button" variant="secondary" onClick={() => setEnding(null)}>Cancel</Button> : null}
          </div>
        </form>
      ) : null}
      {items && !canWrite ? <p className="fo-muted">Changing Operational Scope is offered to holders of {OPERATIONAL_SCOPE_WRITE_CAPABILITY}; the Workforce service re-checks it.</p> : null}
      <WorkforceOutcome outcome={outcome} />
    </RuledSection>
  );
}

/**
 * The Operational Scope target choice, drawn ONLY from the server's listOperationalScopeTargets answer. A scope type
 * with no governed value is shown disabled with the server's reason; without the server's answer nothing is offered.
 */
function ScopeTargetPicker({ targetsRead, targets, scopeType, scopeId, chosenType, offered, onScopeType, onScopeId }) {
  if (!targets) {
    return (
      <p className="fo-muted" data-operational-scope-picker={targetsRead.status === WORKFORCE_READ_STATE.FAILED ? "UNAVAILABLE" : targetsRead.status.toUpperCase()}>
        {targetsRead.status === WORKFORCE_READ_STATE.FAILED
          ? `No scope target can be offered: the governed target list could not be read (${workforceRefusal(targetsRead.error)}).`
          : "Reading the governed scope targets…"}
      </p>
    );
  }
  const unavailable = targets.filter((t) => !t.available);
  return (
    <div data-operational-scope-picker="READY">
      <label className="fo-form-field">
        <span>Scope type</span>
        <select aria-label="Scope type to assign" value={scopeType} onChange={(e) => onScopeType(e.target.value)}>
          <option value="">Choose…</option>
          {targets.map((t) => (
            <option key={t.scopeType} value={t.scopeType} disabled={!t.available}>
              {t.available ? (t.label ?? t.scopeType) : `${t.label ?? t.scopeType} — unavailable`}
            </option>
          ))}
        </select>
      </label>
      {chosenType?.available ? (
        <label className="fo-form-field">
          <span>{chosenType.label ?? chosenType.scopeType}</span>
          <select aria-label="Scope target" value={scopeId} onChange={(e) => onScopeId(e.target.value)}>
            <option value="">{offered.length === 0 ? "Every governed target is already held" : "Choose…"}</option>
            {offered.map((v) => <option key={v.value} value={v.value}>{v.label ?? v.value}</option>)}
          </select>
        </label>
      ) : null}
      {unavailable.length > 0 ? (
        <p className="fo-muted" data-unavailable-scope-types>
          {`Unavailable: ${unavailable.map((t) => `${t.label ?? t.scopeType} (${t.reason ?? "no governed value"})`).join("; ")}.`}
        </p>
      ) : null}
    </div>
  );
}
