// Issue #325 W-SAVE -- the Saved Reports surface, backed by Inventory's TRUSTED saved-definition
// callables (savedReportService.js). No direct `reportDefinitions` access; every read/mutation goes
// through a callable that authorizes server-side and audits every mutation. Private by owner (the
// list is server-scoped to the caller).
//
// Fail-closed + confirmed-only:
//  - Each action is gated on its own capability decision from the trusted feed (hasCapability), and
//    the surface itself is reached only when the feed grants report.definition.read.
//  - No optimistic success: the UI updates only from confirmed callable results -- after every
//    mutation we RE-LIST from the server (server truth), never splice a returned record.
//  - The list is (re)loaded on mount, on principal change, and on accessVersion change (freshness);
//    a revocation of read hides the surface (nav gate) and unmounts this component, clearing state.
//  - Callable errors map to safe states (loading / empty / denied / unavailable / retry / failure)
//    via savedReportServiceOutcome.js -- never a raw code/path/id.
//
// Keyboard-first, list semantics, live-region status. Opening a report revalidates it against the
// current catalog (savedReportReconcile.js) and surfaces catalog drift without restoring it.
//
// Site-work r4 E (Fix 2) -- Open now actually hydrates the Report Builder: an openable report
// navigates to /reporting/builder?open=<id> (ReportBuilder.jsx re-fetches + re-reconciles from
// there itself, the same trusted get() + reconciler this file already uses for its own preview).
// An UNOPENABLE report still shows the inline refusal below rather than navigating anywhere --
// there is nothing useful to hydrate.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { savedReportService } from "../../domain/reporting/savedReportService.js";
import { normalizeList, mapSavedDefinitionError, SAVED_DEFINITION_OUTCOME } from "../../domain/reporting/savedReportServiceOutcome.js";
import { reconcileSavedReport } from "../../domain/reporting/savedReportReconcile.js";
import { REPORT_DEFINITION_CAPABILITIES as CAP } from "../../access/reportAccess.js";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import LoadingState from "../../shared/ui/LoadingState";
import { Button } from "../../shared/ui/primitives";

// A minimal valid definition for a brand-new saved report. (Saving the CURRENT builder definition is
// a later wiring; here "New" persists a valid starter so create/rename/duplicate/delete are usable.)
function starterDefinition() {
  return { objectId: "customer", fields: ["customer.name"], filters: [], groupBy: [], sort: [], aggregates: [], presentation: {} };
}

const LIST_STATUS = { LOADING: "loading", READY: "ready", DENIED: "denied", UNAVAILABLE: "unavailable", FAILURE: "failure" };

function statusForOutcome(kind) {
  if (kind === SAVED_DEFINITION_OUTCOME.DENIED) return LIST_STATUS.DENIED;
  if (kind === SAVED_DEFINITION_OUTCOME.UNAVAILABLE) return LIST_STATUS.UNAVAILABLE;
  return LIST_STATUS.FAILURE;
}

export default function SavedReports({ hasCapability = () => false, accessVersion = null, service = savedReportService }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const can = (c) => hasCapability(c) === true;

  const [status, setStatus] = useState(LIST_STATUS.LOADING);
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState(false);          // a mutation is in flight
  const [actionError, setActionError] = useState(null); // { kind, message } from a mutation
  const [successMsg, setSuccessMsg] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [openState, setOpenState] = useState(null);

  const load = useCallback(async () => {
    setStatus(LIST_STATUS.LOADING);
    setActionError(null);
    try {
      const data = await service.list();
      setReports(normalizeList(data));
      setStatus(LIST_STATUS.READY);
    } catch (err) {
      setReports([]);
      setStatus(statusForOutcome(mapSavedDefinitionError(err).kind));
    }
  }, [service]);

  // Load on mount; reload on principal change or accessVersion change (server truth / freshness).
  useEffect(() => {
    if (!uid) { setReports([]); setStatus(LIST_STATUS.DENIED); return; }
    load();
  }, [uid, accessVersion, load]);

  // Run a mutation callable, then RE-LIST from the server. Never claims success optimistically.
  const mutate = async (fn, successText) => {
    setBusy(true);
    setActionError(null);
    setSuccessMsg(null);
    try {
      await fn();
      await load();               // confirmed server truth
      setSuccessMsg(successText);
    } catch (err) {
      const outcome = mapSavedDefinitionError(err);
      setActionError(outcome);
      if (outcome.kind === SAVED_DEFINITION_OUTCOME.NOT_FOUND) await load(); // stale id -> resync
    } finally {
      setBusy(false);
    }
  };

  const onNew = () => mutate(() => service.create({ name: "Untitled report", definition: starterDefinition() }), "Report created.");
  const startRename = (r) => { setRenamingId(r.id); setRenameText(r.name); };
  const commitRename = (id) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (name) mutate(() => service.rename(id, name), "Report renamed.");
  };
  const onDuplicate = (id) => mutate(() => service.duplicate(id), "Report duplicated.");
  const onDelete = (id) => {
    setConfirmingDeleteId(null);
    setOpenState((o) => (o && o.id === id ? null : o));
    mutate(() => service.remove(id), "Report deleted.");
  };
  const onOpen = (r) => {
    const result = reconcileSavedReport(r);
    if (result.openable) { navigate(`/reporting/builder?open=${encodeURIComponent(r.id)}`); return; }
    // Unopenable -- nothing to hydrate; show the inline refusal instead of navigating.
    setOpenState({ id: r.id, name: r.name, result });
  };

  return (
    <div className="fo-main">
      <div className="fo-panel">
        <h2>Saved reports</h2>
        <p className="fo-muted">Your saved reports are private to you. Only the actions you're authorized for are shown.</p>

        {can(CAP.create) && (
          <div className="fo-form">
            <Button type="button" variant="primary" className="fo-btn-large" onClick={onNew} disabled={busy}>New saved report</Button>
          </div>
        )}

        {successMsg && <p className="fo-state fo-tone-info fo-state-message" role="status" aria-live="polite">{successMsg}</p>}
        {actionError && (
          <div className="fo-state fo-tone-warning" role="alert">
            <p className="fo-warning fo-state-message">{actionError.message}</p>
            <Button type="button" variant="secondary" onClick={load} disabled={busy}>Refresh</Button>
          </div>
        )}

        <ListArea
          status={status} reports={reports} busy={busy} can={can}
          onRetry={load} onOpen={onOpen}
          renamingId={renamingId} renameText={renameText} setRenameText={setRenameText}
          startRename={startRename} commitRename={commitRename} cancelRename={() => setRenamingId(null)}
          onDuplicate={onDuplicate}
          confirmingDeleteId={confirmingDeleteId} setConfirmingDeleteId={setConfirmingDeleteId} onDelete={onDelete}
        />

        {openState && <OpenStatus openState={openState} onDismiss={() => setOpenState(null)} />}
      </div>
    </div>
  );
}

function ListArea(props) {
  const { status, reports, onRetry } = props;
  if (status === LIST_STATUS.LOADING) return <LoadingState>Loading your saved reports…</LoadingState>;
  if (status === LIST_STATUS.DENIED) {
    return <FailureState title="Saved reports aren't available" message="You don't have access to saved reports." />;
  }
  if (status === LIST_STATUS.UNAVAILABLE || status === LIST_STATUS.FAILURE) {
    const message = status === LIST_STATUS.UNAVAILABLE
      ? "Saved reports aren't available right now."
      : "Something went wrong loading your saved reports.";
    return (
      <div className="fo-state fo-tone-warning" role="alert">
        <p className="fo-state-title">Couldn't load saved reports</p>
        <p className="fo-warning fo-state-message">{message}</p>
        <Button type="button" variant="secondary" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (reports.length === 0) {
    return <EmptyState title="No saved reports" message="Create a saved report to see it listed here." />;
  }
  return (
    <ul className="fo-saved-report-list" aria-label="Your saved reports">
      {reports.map((report) => <SavedReportRow key={report.id} report={report} {...props} />)}
    </ul>
  );
}

function SavedReportRow({
  report, busy, can, onOpen,
  renamingId, renameText, setRenameText, commitRename, cancelRename, startRename,
  onDuplicate, confirmingDeleteId, setConfirmingDeleteId, onDelete,
}) {
  if (renamingId === report.id) {
    return (
      <li className="fo-saved-report">
        <form className="fo-inline-form" onSubmit={(e) => { e.preventDefault(); commitRename(report.id); }}>
          <label htmlFor={`rename-${report.id}`}>Rename</label>
          <input id={`rename-${report.id}`} type="text" value={renameText} autoFocus
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") cancelRename(); }} />
          <Button type="submit" variant="secondary" disabled={busy}>Save</Button>
          <Button type="button" variant="secondary" onClick={cancelRename}>Cancel</Button>
        </form>
      </li>
    );
  }
  return (
    <li className="fo-saved-report">
      <div className="fo-saved-report-row">
        <span className="fo-saved-report-name">{report.name}</span>
        <span className="fo-muted fo-saved-report-meta">
          {report.updatedAtMillis ? `Updated ${new Date(report.updatedAtMillis).toLocaleDateString()}` : ""}
        </span>
        <span className="fo-btn-row">
          <Button type="button" variant="secondary" onClick={() => onOpen(report)} aria-label={`Open ${report.name}`}>Open</Button>
          {can(CAP.rename) && <Button type="button" variant="secondary" onClick={() => startRename(report)} disabled={busy} aria-label={`Rename ${report.name}`}>Rename</Button>}
          {can(CAP.duplicate) && <Button type="button" variant="secondary" onClick={() => onDuplicate(report.id)} disabled={busy} aria-label={`Duplicate ${report.name}`}>Duplicate</Button>}
          {can(CAP.delete) && (confirmingDeleteId === report.id ? (
            <>
              <Button type="button" variant="destructive" onClick={() => onDelete(report.id)} disabled={busy} aria-label={`Confirm delete ${report.name}`}>Confirm delete</Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmingDeleteId(null)}>Cancel</Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setConfirmingDeleteId(report.id)} disabled={busy} aria-label={`Delete ${report.name}`}>Delete</Button>
          ))}
        </span>
      </div>
    </li>
  );
}

// onOpen (above) navigates straight to the Report Builder for an OPENABLE report -- this inline
// panel is reached only for the UNOPENABLE case, where there is nothing to hydrate.
function OpenStatus({ openState, onDismiss }) {
  const { name, result } = openState;
  return (
    <div className="fo-state fo-tone-warning" role="alert">
      <p className="fo-state-title">“{name}” can’t be opened</p>
      <p className="fo-state-message fo-muted">{result.reason}</p>
      <Button type="button" variant="secondary" onClick={onDismiss}>Dismiss</Button>
    </div>
  );
}
