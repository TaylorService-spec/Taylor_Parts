// FINANCIAL POLICY WORKSPACE (DECISIONS #232 Phase 2) -- Administration > Company Setup > Financial Policy.
//
// One operating company at a time: its policy in effect, the version scheduled or in flight, the draft editor, the
// approval decision, activation, withdrawal / approval cancellation (#232 Phase 3), the version history and the audit trail. Every read and command is the governed
// PostgreSQL Financial Policy operation on /operations/finance; this screen decides NOTHING:
//   * the company list is readMyFinancialPolicyAuthority -- only companies the server says this principal reaches;
//   * every action's availability is the server's `yourActions` / `yourAuthority` answer, computed from the same rules the
//     commands enforce (capability, Owner reservation, company scope, lifecycle, separation of duties). An unavailable
//     action stays VISIBLE, disabled, with the server's reason in words;
//   * a refused command is shown as the server answered it: friendly words AND the server's own code and message.
// The server re-decides every command inside its transaction, so a stale tab meets the same refusal.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, SectionHeader, StatusIndicator } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callFinanceApi } from "../../services/financeApiClient.js";
import {
  POLICY_FIELDS, FIELD_LABELS, LOCKED_MESSAGE, actorWords, auditActionWords, choiceLabel, describeFailure, draftProblems,
  fieldOptions, isCalendarDate, refusalWords, samePolicy, startingPolicy, statusWords, when,
} from "../../domain/financialPolicyAdministration.js";

const ACTION_WORDS = Object.freeze({ read: "View policy", prepare: "Prepare drafts", approve: "Approve or reject", activate: "Activate",
  withdraw: "Withdraw your own versions", cancel: "Cancel approvals" });

/** A refusal: friendly words, then the server's code and message verbatim. */
function Refusal({ failure }) {
  if (!failure) return null;
  return (
    <div role="alert" data-refusal={failure.code}>
      <FormError>{failure.words}</FormError>
      <p className="fo-wizard-hint">
        Server answer: <code>{failure.code}</code>{failure.message ? <> &mdash; {failure.message}</> : null}
      </p>
    </div>
  );
}

/** Why an action is unavailable, from the server's answer. Nothing when it is allowed. */
function Unavailable({ answer, id }) {
  if (!answer || answer.allowed) return null;
  return (
    <p className="fo-wizard-hint" id={id} data-unavailable-reason={answer.reason}>
      Not available: {refusalWords(answer.reason)}
    </p>
  );
}

/** A command button whose availability is the server's answer; the reason is rendered under it when unavailable. */
function ActionButton({ name, answer, busy, extraDisabled = false, onClick, children, variant = "primary" }) {
  const reasonId = `fp-${name}-reason`;
  const allowed = answer?.allowed === true;
  return (
    <div data-action={name} data-allowed={allowed ? "true" : "false"}>
      <Button variant={variant} disabled={!allowed || busy || extraDisabled} onClick={onClick} aria-describedby={allowed ? undefined : reasonId}>
        {children}
      </Button>
      <Unavailable answer={answer} id={reasonId} />
    </div>
  );
}

function PolicyValues({ policy }) {
  if (!policy) return <p className="fo-muted">No policy.</p>;
  return (
    <dl>
      {POLICY_FIELDS.map((f) => (
        <div key={f}>
          <dt className="fo-muted">{FIELD_LABELS[f]}</dt>
          <dd>{choiceLabel(f, policy[f]) ?? <span className="fo-muted">Not chosen</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function VersionCard({ title, version, people }) {
  const s = statusWords(version.status);
  return (
    <div className="fo-panel fo-panel--nested" aria-label={title} data-version={version.id}>
      <SectionHeader title={`${title}: Version ${version.versionNumber}`} />
      <StatusIndicator tone={s.tone}>{s.label}</StatusIndicator>
      {version.effectiveDate ? <p>Effective <span className="fo-tabular-nums">{version.effectiveDate}</span></p> : null}
      <PolicyValues policy={version.policy} />
      <p className="fo-wizard-hint">
        Prepared by {actorWords(version.preparedBy, people)} on {when(version.preparedAt)}
        {version.submittedBy ? <> · submitted by {actorWords(version.submittedBy, people)} on {when(version.submittedAt)}</> : null}
        {version.approvedBy ? <> · approved by {actorWords(version.approvedBy, people)} on {when(version.approvedAt)}</> : null}
        {version.activatedBy ? <> · activated by {actorWords(version.activatedBy, people)} on {when(version.activatedAt)}</> : null}
        {version.withdrawnBy ? <> · withdrawn by {actorWords(version.withdrawnBy, people)} on {when(version.withdrawnAt)}</> : null}
        {version.cancelledBy ? <> · approval cancelled by {actorWords(version.cancelledBy, people)} on {when(version.cancelledAt)}</> : null}
      </p>
      {version.locked ? <p className="fo-wizard-hint">{LOCKED_MESSAGE}</p> : null}
    </div>
  );
}

function DraftEditor({ read, busy, onSave, onSubmit }) {
  const inFlight = read.inFlight;
  const editing = inFlight?.status === "DRAFT" ? inFlight : null;
  const saveAnswer = editing ? editing.yourActions?.edit : read.yourAuthority?.createDraft;
  const [policy, setPolicy] = useState(() => startingPolicy(read));
  const [note, setNote] = useState("");
  useEffect(() => { setPolicy(startingPolicy(read)); setNote(""); }, [read]);
  const problems = draftProblems(policy, read.supported);
  const unsaved = editing ? !samePolicy(policy, editing.policy) : true;
  const canEdit = saveAnswer?.allowed === true;
  return (
    <section className="fo-panel" aria-label="Draft">
      <SectionHeader
        title={editing ? `Draft: Version ${editing.versionNumber}` : "Prepare a New Draft"}
        description={editing
          ? "Edit the draft, save it, then submit it for approval. Submitting freezes its content."
          : "A new draft starts from the policy in effect, if there is one. It changes nothing until it is approved and activated."}
      />
      <div className="fo-form-row">
        {POLICY_FIELDS.map((field) => (
          <Field key={field} id={`fp-field-${field}`} label={FIELD_LABELS[field]} error={canEdit && policy[field] !== "" ? problems[field] : undefined}>
            <select className="fo-input" value={policy[field]} disabled={!canEdit || busy}
              onChange={(e) => setPolicy({ ...policy, [field]: e.target.value })}>
              <option value="">Choose…</option>
              {fieldOptions(field, read.supported).map((o) => (
                <option key={o.id} value={o.id} disabled={!o.available}>
                  {o.available ? o.label : `${o.label} (unavailable: ${o.blockedReason ?? "not available"})`}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <Field id="fp-draft-note" label="Note (Optional, Kept in the Audit Trail)">
        <input className="fo-input" value={note} disabled={!canEdit || busy} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="fo-form-actions">
        <ActionButton name="save" answer={saveAnswer} busy={busy} extraDisabled={Object.keys(problems).length > 0 || !unsaved}
          onClick={() => onSave({ versionId: editing?.id ?? null, policy, note })}>
          {editing ? "Save Draft" : "Create Draft"}
        </ActionButton>
        {editing ? (
          <ActionButton name="submit" answer={editing.yourActions?.submit} busy={busy} extraDisabled={!samePolicy(policy, editing.policy)}
            variant="secondary" onClick={() => onSubmit({ versionId: editing.id, note })}>
            Submit for Approval
          </ActionButton>
        ) : null}
      </div>
      {editing && !samePolicy(policy, editing.policy) && canEdit ? <p className="fo-wizard-hint">Save your changes before submitting.</p> : null}
    </section>
  );
}

function DecisionPanel({ version, busy, onApprove, onReject }) {
  const [approveNote, setApproveNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  return (
    <section className="fo-panel" aria-label="Approval decision">
      <SectionHeader title={`Decide Version ${version.versionNumber}`}
        description="An independent approver reviews the submitted version. Whoever prepared, edited or submitted it cannot decide it." />
      <PolicyValues policy={version.policy} />
      <Field id="fp-approve-note" label="Approval Note (Optional)">
        <input className="fo-input" value={approveNote} disabled={!version.yourActions?.approve?.allowed || busy} onChange={(e) => setApproveNote(e.target.value)} />
      </Field>
      <ActionButton name="approve" answer={version.yourActions?.approve} busy={busy} onClick={() => onApprove({ versionId: version.id, note: approveNote })}>
        Approve
      </ActionButton>
      <Field id="fp-reject-reason" label="Rejection Reason (Required to Reject)">
        <input className="fo-input" value={rejectReason} disabled={!version.yourActions?.reject?.allowed || busy} onChange={(e) => setRejectReason(e.target.value)} />
      </Field>
      <ActionButton name="reject" answer={version.yourActions?.reject} busy={busy} extraDisabled={rejectReason.trim() === ""} variant="destructive"
        onClick={() => onReject({ versionId: version.id, reason: rejectReason.trim() })}>
        Reject
      </ActionButton>
    </section>
  );
}

function ActivationPanel({ version, asOf, busy, onActivate }) {
  const [effectiveDate, setEffectiveDate] = useState(asOf ?? "");
  const [note, setNote] = useState("");
  useEffect(() => { setEffectiveDate(asOf ?? ""); }, [asOf]);
  const allowed = version.yourActions?.activate?.allowed === true;
  return (
    <section className="fo-panel" aria-label="Activation">
      <SectionHeader title={`Activate Version ${version.versionNumber}`}
        description="Activation locks the version and supersedes the current one. It governs from its effective date; a future date schedules it." />
      <Field id="fp-effective-date" label="Effective Date" hint={asOf ? `The company's business date today is ${asOf}.` : undefined}>
        <input className="fo-input" type="date" value={effectiveDate} disabled={!allowed || busy} onChange={(e) => setEffectiveDate(e.target.value)} />
      </Field>
      <Field id="fp-activate-note" label="Activation Note (Optional)">
        <input className="fo-input" value={note} disabled={!allowed || busy} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ActionButton name="activate" answer={version.yourActions?.activate} busy={busy} extraDisabled={!isCalendarDate(effectiveDate)}
        onClick={() => onActivate({ versionId: version.id, effectiveDate, note })}>
        Activate
      </ActionButton>
    </section>
  );
}

/**
 * WITHDRAW (a DRAFT / SUBMITTED version, by its own preparer) or CANCEL APPROVAL (an APPROVED version, by the Owner or the
 * Administrator) -- #232 Phase 3. Availability is the server's `yourActions`; the act always passes through a confirmation
 * that states its consequence and requires a reason. The server decides again.
 */
const CLOSING = Object.freeze({
  withdraw: { operation: "withdrawFinancialPolicy", button: "Withdraw", confirm: "Withdraw Version", done: "Withdrawn",
    title: "Withdraw This Version", description: "Withdrawing takes the version out of progress so a new draft can be prepared.",
    consequence: (n) => `This withdraws Version ${n}. It stays in the history and is final.` },
  cancel: { operation: "cancelFinancialPolicy", button: "Cancel Approval", confirm: "Cancel Approval", done: "Approval cancelled",
    title: "Cancel This Approval", description: "Cancelling the approval means this version will never be activated; a new draft can then be prepared.",
    consequence: (n) => `This cancels the approval of Version ${n}. It stays in the history, is final and will never be activated.` },
});

function ClosePanel({ version, kind, busy, onClose }) {
  const words = CLOSING[kind];
  const answer = version.yourActions?.[kind];
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { setConfirming(false); setReason(""); }, [version.id, version.status]);
  return (
    <section className="fo-panel" aria-label={words.title}>
      <SectionHeader title={words.title} description={words.description} />
      {!confirming ? (
        <ActionButton name={kind} answer={answer} busy={busy} variant="destructive" onClick={() => setConfirming(true)}>
          {words.button}
        </ActionButton>
      ) : (
        <div role="group" aria-label={`Confirm: ${words.title}`} data-confirm={kind}>
          <p><strong>{words.consequence(version.versionNumber)}</strong></p>
          <Field id={`fp-${kind}-reason`} label="Reason (Required, Kept in the Audit Trail)">
            <input className="fo-input" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="fo-form-actions">
            <ActionButton name={`confirm-${kind}`} answer={answer} busy={busy} extraDisabled={reason.trim() === ""} variant="destructive"
              onClick={() => onClose({ versionId: version.id, reason: reason.trim() })}>
              {words.confirm}
            </ActionButton>
            <Button variant="secondary" disabled={busy} onClick={() => { setConfirming(false); setReason(""); }}>Keep It</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function VersionHistory({ items, people }) {
  return (
    <section className="fo-panel" aria-label="Version history">
      <SectionHeader title="Version History" description="Every version of this company's policy, newest first. Versions are never deleted." />
      {items.length === 0 ? <p className="fo-muted">No versions yet.</p> : (
        <table className="fo-table" aria-label="Financial policy versions">
          <thead><tr><th>Version</th><th>Status</th><th>Policy</th><th>Prepared</th><th>Submitted</th><th>Decision</th><th>Activated</th><th>Effective</th><th>Withdrawn or Cancelled</th></tr></thead>
          <tbody>
            {items.map((v) => {
              const decidedBy = v.approvedBy ?? v.rejectedBy;
              const decidedAt = v.approvedAt ?? v.rejectedAt;
              const closedBy = v.withdrawnBy ?? v.cancelledBy ?? null;
              const closedAt = v.withdrawnAt ?? v.cancelledAt ?? null;
              const closedReason = v.withdrawalReason ?? v.cancellationReason ?? null;
              return (
                <tr key={v.id} data-version-row={v.versionNumber}>
                  <td className="fo-tabular-nums">{v.versionNumber}</td>
                  <td><StatusIndicator tone={statusWords(v.status).tone}>{statusWords(v.status).label}</StatusIndicator></td>
                  <td>{choiceLabel("inventoryCostMethod", v.policy.inventoryCostMethod)} · {choiceLabel("cogsRecognitionPointId", v.policy.cogsRecognitionPointId)}</td>
                  <td>{actorWords(v.preparedBy, people)}<br /><span className="fo-muted">{when(v.preparedAt)}</span></td>
                  <td>{v.submittedBy ? <>{actorWords(v.submittedBy, people)}<br /><span className="fo-muted">{when(v.submittedAt)}</span></> : <span className="fo-muted">—</span>}</td>
                  <td>{decidedBy ? <>{v.rejectedBy ? "Rejected" : "Approved"} by {actorWords(decidedBy, people)}<br /><span className="fo-muted">{when(decidedAt)}</span>
                    {v.decisionReason ? <><br />&ldquo;{v.decisionReason}&rdquo;</> : null}</> : <span className="fo-muted">—</span>}</td>
                  <td>{v.activatedBy ? <>{actorWords(v.activatedBy, people)}<br /><span className="fo-muted">{when(v.activatedAt)}</span></> : <span className="fo-muted">—</span>}</td>
                  <td className="fo-tabular-nums">{v.effectiveDate ?? <span className="fo-muted">—</span>}{v.supersededAt ? <><br /><span className="fo-muted">superseded {when(v.supersededAt)}</span></> : null}</td>
                  <td>{closedBy ? <>{v.withdrawnBy ? "Withdrawn" : "Approval cancelled"} by {actorWords(closedBy, people)}<br /><span className="fo-muted">{when(closedAt)}</span>
                    {closedReason ? <><br />&ldquo;{closedReason}&rdquo;</> : null}</> : <span className="fo-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AuditTrail({ events, people }) {
  return (
    <section className="fo-panel" aria-label="Audit trail">
      <SectionHeader title="Audit Trail" description="Every recorded change to this company's policy versions, with who made it, when, and the stated reason." />
      {events.length === 0 ? <p className="fo-muted">Nothing recorded yet.</p> : (
        <table className="fo-table" aria-label="Financial policy audit trail">
          <thead><tr><th>When</th><th>Action</th><th>Version</th><th>By</th><th>Reason or Note</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} data-audit-action={e.action}>
                <td className="fo-tabular-nums">{when(e.occurredAt)}</td>
                <td>{auditActionWords(e.action)}</td>
                <td className="fo-tabular-nums">{e.versionNumber ?? "—"}</td>
                <td>{actorWords(e.actorPrincipalId, people)}</td>
                <td>{e.reason ?? <span className="fo-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function FinancialPolicyWorkspace({ financeApi = callFinanceApi }) {
  const [authority, setAuthority] = useState({ loading: true, failure: null, data: null });
  const [companyId, setCompanyId] = useState("");
  const [company, setCompany] = useState({ loading: false, failure: null, read: null, list: null });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null); // { ok: true, text } | { ok: false, failure }

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await financeApi("readMyFinancialPolicyAuthority", {});
      if (!live) return;
      if (!res.ok) { setAuthority({ loading: false, failure: describeFailure(res), data: null }); return; }
      setAuthority({ loading: false, failure: null, data: res.result });
      setCompanyId((current) => current || res.result?.companies?.[0]?.operatingCompanyId || "");
    })();
    return () => { live = false; };
  }, [financeApi]);

  // THE CURRENT SELECTION, read by every async continuation: a response that arrives after the selection moved (or that
  // names another company) is dropped, so one company's policy is never drawn under another's name.
  const selection = useRef("");
  const loadCompany = useCallback(async (id) => {
    selection.current = id;
    if (!id) return;
    setCompany({ loading: true, failure: null, read: null, list: null });
    const [read, list] = await Promise.all([
      financeApi("readFinancialPolicy", { operatingCompanyId: id }),
      financeApi("listFinancialPolicyVersions", { operatingCompanyId: id }),
    ]);
    if (selection.current !== id) return; // stale: the selection moved while this was in flight
    if (!read.ok || !list.ok) {
      setCompany({ loading: false, failure: describeFailure(read.ok ? list : read), read: null, list: null });
      return;
    }
    if (read.result?.operatingCompanyId !== id || list.result?.operatingCompanyId !== id) return; // not this company's answer
    setCompany({ loading: false, failure: null, read: read.result, list: list.result });
  }, [financeApi]);

  useEffect(() => { setOutcome(null); loadCompany(companyId); }, [companyId, loadCompany]);

  const run = async (operation, input, success) => {
    const target = companyId;
    setBusy(true);
    setOutcome(null);
    const res = await financeApi(operation, { operatingCompanyId: target, ...input });
    setBusy(false);
    if (selection.current !== target) return; // the selector is disabled while busy; this is belt and braces
    if (!res.ok) { setOutcome({ ok: false, failure: describeFailure(res) }); return; }
    setOutcome({ ok: true, text: res.result?.replayed ? `${success} (already recorded; nothing changed).` : `${success}.` });
    await loadCompany(target);
  };
  const note = (text) => (typeof text === "string" && text.trim() !== "" ? { reason: text.trim() } : {});

  const companies = authority.data?.companies ?? [];
  const selected = companies.find((c) => c.operatingCompanyId === companyId) ?? null;
  const read = company.read;
  const people = useMemo(() => ({
    me: authority.data?.principalId ?? null,
    names: { ...(read?.actorNames ?? {}), ...(company.list?.actorNames ?? {}) },
  }), [authority.data, read, company.list]);

  if (authority.loading) return <StatusIndicator tone="neutral">Loading your Financial Policy access&hellip;</StatusIndicator>;
  if (authority.failure) {
    return (
      <section className="fo-panel" aria-label="Financial policy access">
        <SectionHeader title="Financial Policy" />
        <Refusal failure={authority.failure} />
      </section>
    );
  }
  if (companies.length === 0) {
    return <StatusIndicator tone="neutral">No active operating company is within your Financial Policy access.</StatusIndicator>;
  }

  const inFlight = read?.inFlight ?? null;
  const showEditor = read && (inFlight === null || inFlight.status === "DRAFT");

  return (
    <div data-financial-policy-workspace>
      <section className="fo-panel" aria-label="Operating company">
        <Field id="fp-company" label="Operating Company" hint="Only the companies your Financial Policy access covers are listed.">
          <select className="fo-input" value={companyId} disabled={busy} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.operatingCompanyId} value={c.operatingCompanyId}>{c.name}</option>)}
          </select>
        </Field>
        {selected ? (
          <ul aria-label="Your Financial Policy actions">
            {Object.entries(ACTION_WORDS).map(([key, words]) => {
              const answer = selected.actions?.[key];
              return (
                <li key={key} data-company-action={key} data-allowed={answer?.allowed ? "true" : "false"}>
                  <StatusIndicator tone={answer?.allowed ? "positive" : "muted"}>{words}{answer?.allowed ? "" : ": not available"}</StatusIndicator>
                  {answer?.allowed ? null : <span className="fo-wizard-hint"> {refusalWords(answer?.reason)}</span>}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {outcome?.ok ? <p className="fo-muted" role="status">{outcome.text}</p> : null}
      {outcome && !outcome.ok ? <Refusal failure={outcome.failure} /> : null}

      {company.loading && !read ? <StatusIndicator tone="neutral">Loading this company&rsquo;s financial policy&hellip;</StatusIndicator> : null}
      {company.failure ? <Refusal failure={company.failure} /> : null}

      {read ? (
        <>
          <section className="fo-panel" aria-label="Policy summary">
            <SectionHeader title="Policy Summary" description={`As of the company's business date, ${read.asOf}.`} />
            {read.state === "NOT_CONFIGURED" ? (
              <StatusIndicator tone="attention">Not configured: no policy is in effect. EOS applies no costing method until one is activated.</StatusIndicator>
            ) : null}
            {read.inForce ? <VersionCard title="In Effect" version={read.inForce} people={people} /> : null}
            {read.scheduled ? <VersionCard title="Scheduled" version={read.scheduled} people={people} /> : null}
            {inFlight ? <VersionCard title="In Progress" version={inFlight} people={people} /> : <p className="fo-muted">No version is in progress.</p>}
          </section>

          {showEditor ? (
            <DraftEditor read={read} busy={busy}
              onSave={({ versionId, policy, note: n }) => run("saveFinancialPolicyDraft", { ...(versionId ? { versionId } : {}), policy, ...note(n) }, "Draft saved")}
              onSubmit={({ versionId, note: n }) => run("submitFinancialPolicy", { versionId, ...note(n) }, "Submitted for approval")} />
          ) : null}
          {inFlight?.status === "SUBMITTED" ? (
            <DecisionPanel version={inFlight} busy={busy}
              onApprove={({ versionId, note: n }) => run("approveFinancialPolicy", { versionId, ...note(n) }, "Approved")}
              onReject={({ versionId, reason }) => run("rejectFinancialPolicy", { versionId, reason }, "Rejected")} />
          ) : null}
          {inFlight?.status === "APPROVED" ? (
            <ActivationPanel version={inFlight} asOf={read.asOf} busy={busy}
              onActivate={({ versionId, effectiveDate, note: n }) => run("activateFinancialPolicy", { versionId, effectiveDate, ...note(n) }, "Activated")} />
          ) : null}
          {inFlight && (inFlight.status === "DRAFT" || inFlight.status === "SUBMITTED" || inFlight.status === "APPROVED") ? (
            <ClosePanel version={inFlight} kind={inFlight.status === "APPROVED" ? "cancel" : "withdraw"} busy={busy}
              onClose={({ versionId, reason }) => {
                const kind = inFlight.status === "APPROVED" ? "cancel" : "withdraw";
                return run(CLOSING[kind].operation, { versionId, reason }, CLOSING[kind].done);
              }} />
          ) : null}

          <VersionHistory items={company.list?.items ?? []} people={people} />
          <AuditTrail events={company.list?.auditTrail ?? []} people={people} />
        </>
      ) : null}
    </div>
  );
}
