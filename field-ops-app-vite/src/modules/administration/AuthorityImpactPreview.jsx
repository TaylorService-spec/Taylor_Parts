// THE AUTHORITY IMPACT PREVIEW -- the step between "reason" and "Confirm" for every authority change (PR 4).
//
// Every one of the nine authority-changing Administration commands (Role grants, whole-object authority, conditions,
// direct exceptions, Security Role assignment) is previewed by the SERVER before it can be confirmed:
// `previewAuthorityChange` runs the unchanged command inside a transaction that is always rolled back and answers what
// it WOULD do -- WOULD_APPLY / NO_OP / WOULD_REFUSE (with the commit's own refusal) / PREVIEW_BUSY -- and who it would
// affect. Confirm then sends the preview's `previewDigest`; the server recomputes it under the governance lock and
// refuses STALE_PREVIEW when anything moved in between.
//
// WHAT THE BROWSER DECIDES: NOTHING. It never computes an impact, never predicts a refusal, never relaxes the rule:
//   - Confirm is DISABLED until a FRESH preview of EXACTLY the inputs on screen answered WOULD_APPLY. Any change to
//     the inputs (reason included) discards the preview -- the key is the very input object Confirm would send.
//   - NO_OP offers nothing to confirm; WOULD_REFUSE shows the server's refusal verbatim and offers nothing to confirm.
//   - A preview that could not be taken (UNKNOWN_OPERATION, FORBIDDEN, UNREACHABLE...) is shown as itself and Confirm
//     stays disabled: fail closed, never "confirm without a preview".
//   - STALE_PREVIEW on commit discards the preview, says so, and requires a new preview and a new Confirm.
import { useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import Modal from "../../shared/ui/Modal.jsx";
import { Field, FormActions, FormStatus } from "../../shared/ui/form/index.js";
import { AUTHORITY_CHANGE_INPUT, isAuthorityChangeOperation, refusalText } from "../../services/adminControlPlaneClient.js";

/** The commit refusal that means "the authority moved since the preview": the code rides in the message. */
export const isStalePreview = (result) => Boolean(result && result.ok === false && typeof result.message === "string"
  && /^STALE_PREVIEW\b/.test(result.message));

const IDLE = Object.freeze({ key: null, status: "idle", result: null, error: null });

/**
 * The preview state for ONE pending authority change. `operation` null (no form open) is idle.
 *
 *   run()        ask the server for the preview of exactly (operation, args) as they are now
 *   canConfirm   a fresh WOULD_APPLY preview exists
 *   previewDigest  what Confirm sends (null unless canConfirm)
 *   settle(outcome)  hand the commit's answer back: success or STALE_PREVIEW discard the preview
 */
export function useAuthorityImpactPreview(api, operation, args) {
  const key = operation && isAuthorityChangeOperation(operation)
    ? JSON.stringify([operation, AUTHORITY_CHANGE_INPUT[operation](args ?? {})])
    : null;
  const [state, setState] = useState(IDLE);
  const [stale, setStale] = useState(false);
  const sequence = useRef(0);
  const current = key !== null && state.key === key ? state : { ...IDLE, key };

  const run = async () => {
    if (key === null) return;
    sequence.current += 1;
    const mine = sequence.current;
    setStale(false);
    setState({ key, status: "loading", result: null, error: null });
    let answer;
    if (typeof api?.previewAuthorityChange !== "function") {
      answer = { ok: false, code: "UNKNOWN_OPERATION", message: "this screen has no grant-impact preview" };
    } else {
      try {
        answer = await api.previewAuthorityChange(operation, args ?? {});
      } catch {
        answer = { ok: false, code: "UNREACHABLE", message: "the Administration API could not be reached" };
      }
    }
    if (mine !== sequence.current) return;
    if (answer?.ok && answer.data && typeof answer.data.outcome === "string") {
      setState({ key, status: "ready", result: answer.data, error: null });
    } else {
      setState({ key, status: "failed", result: null,
        error: answer?.ok ? { ok: false, code: "INTERNAL", message: "the preview answer was unreadable" } : answer });
    }
  };

  const digest = current.status === "ready" && current.result.outcome === "WOULD_APPLY"
    && typeof current.result.digests?.previewDigest === "string" && current.result.digests.previewDigest.length > 0
    ? current.result.digests.previewDigest : null;

  const settle = (outcome) => {
    if (isStalePreview(outcome)) {
      sequence.current += 1;
      setState(IDLE);
      setStale(true);
    } else if (outcome?.ok) {
      sequence.current += 1;
      setState(IDLE);
      setStale(false);
    }
    return outcome;
  };

  return { ...current, stale, run, previewDigest: digest, canConfirm: digest !== null, settle };
}

const CHANGE_LABELS = Object.freeze({
  flat: "capabilities",
  conditionallyHeld: "conditioned capabilities",
  scopedHeld: "scoped capabilities",
  inertScoped: "inert scoped holdings",
  protectedAdministratorKeys: "Administrator-implied capabilities",
  directGrants: "direct exceptions",
  heldRoleKeys: "Security Roles",
  scopedAssignments: "scoped assignments",
  surfaces: "surfaces",
  fieldGroups: "field groups",
  administration: "Administration gates",
  latent: "latent (ineligible) capabilities",
});

function PersonImpact({ person }) {
  const fields = Object.entries(person.changes ?? {});
  return (
    <li data-preview-principal={person.principalId}>
      <strong>{person.principalId}</strong>
      {person.protectedStanding ? (
        <>{" "}<span className="fo-cp-tag fo-cp-tag--invariant" data-preview-protected={person.protectedStanding}>
          {person.protectedStanding === "OWNER" ? "Protected Owner" : "Protected Administrator"}
        </span></>
      ) : null}
      {person.status ? <span className="fo-muted">{` · Resolution ${person.status.before} → ${person.status.after}`}</span> : null}
      <ul>
        {fields.map(([field, { added = [], removed = [] }]) => (
          <li key={field} data-preview-change={field}>
            {`${CHANGE_LABELS[field] ?? field}: `}
            {added.length > 0 ? <span data-preview-gains>{`gains ${added.join(", ")}`}</span> : null}
            {added.length > 0 && removed.length > 0 ? "; " : null}
            {removed.length > 0 ? <span data-preview-losses>{`loses ${removed.join(", ")}`}</span> : null}
          </li>
        ))}
      </ul>
      {(person.notes ?? []).length > 0 ? <p className="fo-muted">{person.notes.join(" · ")}</p> : null}
    </li>
  );
}

function ImpactReport({ report }) {
  const outcome = report.outcome;
  const protectedAffected = report.protectedAffected ?? { owners: 0, administrators: 0 };
  return (
    <div data-preview-outcome={outcome}>
      {outcome === "WOULD_APPLY" ? <p className="fo-muted" role="status">The server would apply this change.</p> : null}
      {outcome === "NO_OP" ? <p className="fo-muted" role="status">Nothing changes: this authority is already as requested. There is nothing to confirm.</p> : null}
      {outcome === "WOULD_REFUSE" ? (
        <p className="fo-warning" role="alert" data-preview-refusal={report.refusal?.code ?? "UNKNOWN"}>
          {`The server would refuse this change. ${report.refusal?.category ?? "REFUSED"}: ${report.refusal?.message ?? report.refusal?.code ?? ""}`}
        </p>
      ) : null}
      {outcome === "PREVIEW_BUSY" ? (
        <p className="fo-warning" role="alert" data-preview-busy={report.busy?.reason ?? "BUSY"}>
          {`The server could not preview right now (${report.busy?.reason ?? "busy"}). Preview again.`}
        </p>
      ) : null}
      {outcome === "WOULD_APPLY" || outcome === "NO_OP" ? (
        <p className="fo-muted" data-preview-counts>
          {`${report.affectedCount ?? 0} ${report.affectedCount === 1 ? "person" : "people"} affected · ${report.unaffectedHolders ?? 0} current holder(s) unaffected`}
        </p>
      ) : null}
      {(protectedAffected.owners ?? 0) > 0 || (protectedAffected.administrators ?? 0) > 0 ? (
        <p className="fo-warning" role="alert" data-preview-protected-affected>
          {`This change affects ${protectedAffected.owners ?? 0} protected Owner(s) and ${protectedAffected.administrators ?? 0} protected Administrator(s).`}
        </p>
      ) : null}
      {Array.isArray(report.perAction) && report.perAction.length > 0 ? (
        <ul aria-label="Per action">
          {report.perAction.map((a) => (
            <li key={a.actionKey} data-preview-action={a.actionKey}>
              {`${a.actionKey} (${a.capabilityKey}): ${a.outcome}${a.refusalCode ? ` — ${a.refusalCode}` : ""}`}
            </li>
          ))}
        </ul>
      ) : null}
      {outcome === "WOULD_APPLY" && report.detail === "FULL" && Array.isArray(report.affected) ? (
        <ul aria-label="Affected people">
          {report.affected.map((p) => <PersonImpact key={p.principalId} person={p} />)}
        </ul>
      ) : null}
      {outcome === "WOULD_APPLY" && report.detail !== "FULL" ? (
        <p className="fo-muted" data-preview-detail="COUNTS_ONLY">Counts only: naming the affected people requires Principal Access read.</p>
      ) : null}
    </div>
  );
}

/**
 * The preview step. `disabled` while the change is not yet complete (e.g. no stated reason): the reason is part of
 * what is previewed, so a preview is only taken of a change that could be confirmed as it stands.
 */
export function AuthorityImpactPreview({ preview, disabled = false }) {
  const { status } = preview;
  return (
    <section aria-label="Impact preview"
      data-authority-preview={status === "ready" ? preview.result.outcome : status.toUpperCase()}>
      {preview.stale ? (
        <p className="fo-warning" role="alert" data-preview-stale>
          STALE_PREVIEW: authority changed since the preview, and nothing was saved. Preview the impact again, then confirm.
        </p>
      ) : null}
      <div className="fo-btn-row">
        <Button type="button" variant="secondary" onClick={preview.run} disabled={disabled || status === "loading"}>
          {status === "ready" || status === "failed" ? "Preview impact again" : "Preview impact"}
        </Button>
      </div>
      {status === "idle" ? (
        <p className="fo-muted">Preview the impact first: Confirm is enabled only after the server shows what this change does.</p>
      ) : null}
      {status === "loading" ? <p className="fo-muted" role="status">Previewing the impact…</p> : null}
      {status === "failed" ? (
        <p className="fo-warning" role="alert" data-preview-failure={preview.error?.code ?? "INTERNAL"}>
          {`The impact preview is unavailable, so this change cannot be confirmed here. (${refusalText(preview.error) ?? "INTERNAL"})`}
        </p>
      ) : null}
      {status === "ready" ? <ImpactReport report={preview.result} /> : null}
    </section>
  );
}

/**
 * A confirmation dialog for ONE authority change, with the preview step built in: reason -> Preview impact -> Confirm.
 * Used where a change used to commit from a bare confirm (the matrix bulk dialog) or from ONE click (the matrix cell).
 *
 *   argsFor(reason)  the change's arguments with the reason as typed (trimmed); the preview and the commit share them
 *   onResult(res)    the commit's answer, success or a refusal (a STALE_PREVIEW keeps the dialog open instead)
 *   noChange         nothing would be sent (e.g. an empty bulk plan): Confirm only closes, no preview is asked
 */
export function AuthorityChangeDialog({
  api, operation, argsFor, title, consequence, extraNote, confirmLabel, destructive = false,
  initialReason = "", reasonLabel = "Reason (Recorded in the Audit Trail)", noChange = false, onResult, onClose,
}) {
  const [reason, setReason] = useState(initialReason);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const trimmed = reason.trim();
  const args = argsFor(trimmed);
  const preview = useAuthorityImpactPreview(api, noChange ? null : operation, args);

  const close = () => { if (!submittingRef.current) onClose(); };
  const confirm = async () => {
    if (noChange) { onClose(); return; }
    if (submittingRef.current || !trimmed || !preview.canConfirm) return;
    submittingRef.current = true;
    setSubmitting(true);
    let res;
    try {
      res = preview.settle(await api[operation]({ ...args, previewDigest: preview.previewDigest }));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    if (!isStalePreview(res)) onResult?.(res);
  };

  return (
    <Modal title={title} onClose={close} closeLabel="Close">
      <div className="fo-confirm-dialog fo-create-modal-form" data-authority-change-dialog={operation}>
        {destructive ? <p className="fo-warning fo-confirm-severity"><span>Removes authority</span></p> : null}
        {consequence ? <p className={`fo-confirm-consequence${destructive ? " fo-confirm-consequence--destructive" : ""}`}>{consequence}</p> : null}
        {extraNote ? <div className="fo-muted fo-confirm-note">{extraNote}</div> : null}
        {noChange ? null : (
          <>
            <Field id="authority-change-reason" label={reasonLabel} required>
              <textarea id="authority-change-reason" className="fo-wizard-control" rows={3} value={reason}
                onChange={(e) => setReason(e.target.value)} />
            </Field>
            <AuthorityImpactPreview preview={preview} disabled={!trimmed || submitting} />
          </>
        )}
        <FormStatus>{submitting ? "Working…" : ""}</FormStatus>
        <FormActions className="fo-confirm-actions">
          <Button type="button" variant={destructive ? "destructive" : "primary"} onClick={confirm}
            disabled={!noChange && (!trimmed || !preview.canConfirm || submitting)} loading={submitting}>
            {confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={close} disabled={submitting}>Cancel</Button>
        </FormActions>
      </div>
    </Modal>
  );
}
