// Issue #325 / ADR-007 W-SAVE-UI foundation -- the inert saved-report UI shell.
//
// Lists the owner's saved reports and offers create / rename / duplicate / delete, all held IN
// MEMORY (savedReportStore.js) -- there is NO persistence, no Firestore, no Rules, no sharing, no
// scheduling. UNAVAILABLE-SAFE: opening a saved report REVALIDATES it against the current catalog
// (savedReportReconcile.js) and surfaces what catalog change removed, but editing/running it is not
// available yet (the Report Builder is hidden until a trusted effective-access feed exists), so
// "Open" reports availability instead of navigating anywhere.
//
// This shell is intentionally NOT wired into navConfig.js/App.jsx -- it is unreachable, exactly
// like the hidden Report Builder. Keyboard-first (native <button>/<input>, associated <label>s),
// list semantics, and live-region status.
import { useState } from "react";
import {
  createInStore, renameInStore, duplicateInStore, deleteFromStore, reportsForOwner,
} from "../../domain/reporting/savedReportStore.js";
import { reconcileSavedReport, describeReconciliation } from "../../domain/reporting/savedReportReconcile.js";
import EmptyState from "../../shared/ui/EmptyState";

// A minimal valid starter definition for a brand-new saved report (a real save-from-builder flow is
// W-SAVE activation; here "New" just seeds a valid, inert definition so the shell is usable).
function starterDefinition() {
  return { objectId: "customer", fields: ["customer.name"], filters: [], groupBy: [], sort: [], aggregates: [], presentation: {} };
}

const newId = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `sr-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function SavedReports({ ownerUid = "me", initialReports = [] }) {
  const [reports, setReports] = useState(initialReports);
  const [renamingId, setRenamingId] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [openState, setOpenState] = useState(null); // { id, name, result }

  const mine = reportsForOwner(reports, ownerUid);

  const onNew = () => {
    setReports((r) => createInStore(r, {
      id: newId(), name: "Untitled report", ownerUid, definition: starterDefinition(), now: Date.now(),
    }));
  };

  const startRename = (report) => { setRenamingId(report.id); setRenameText(report.name); };
  const commitRename = (id) => {
    const name = renameText.trim();
    if (name) setReports((r) => renameInStore(r, id, ownerUid, name, Date.now()));
    setRenamingId(null);
  };

  const onDuplicate = (id) => {
    setReports((r) => duplicateInStore(r, id, ownerUid, { newId: newId(), now: Date.now() }));
  };

  const onDelete = (id) => {
    setReports((r) => deleteFromStore(r, id, ownerUid));
    setConfirmingDeleteId(null);
    setOpenState((o) => (o && o.id === id ? null : o));
  };

  const onOpen = (report) => {
    // Revalidate + reconcile against the CURRENT catalog on every open (Spec §7/§8).
    setOpenState({ id: report.id, name: report.name, result: reconcileSavedReport(report) });
  };

  return (
    <div className="fo-main">
      <div className="fo-panel">
        <h2>Saved reports</h2>
        <p className="fo-muted">
          Your saved reports are private to you and kept in memory only — nothing is saved to a
          server yet. Opening a report checks it against the current data catalog; editing and
          running reports isn’t available yet.
        </p>

        <div className="fo-form">
          <button type="button" className="fo-btn-large" onClick={onNew}>New saved report</button>
        </div>

        {mine.length === 0 ? (
          <EmptyState
            title="No saved reports"
            message="Create a saved report to see it listed here."
          />
        ) : (
          <ul className="fo-saved-report-list" aria-label="Your saved reports">
            {mine.map((report) => (
              <li key={report.id} className="fo-saved-report">
                {renamingId === report.id ? (
                  <form
                    className="fo-inline-form"
                    onSubmit={(e) => { e.preventDefault(); commitRename(report.id); }}
                  >
                    <label htmlFor={`rename-${report.id}`}>Rename</label>
                    <input
                      id={`rename-${report.id}`}
                      type="text"
                      value={renameText}
                      autoFocus
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                    />
                    <button type="submit" className="fo-btn-secondary">Save</button>
                    <button type="button" className="fo-btn-secondary" onClick={() => setRenamingId(null)}>Cancel</button>
                  </form>
                ) : (
                  <div className="fo-saved-report-row">
                    <span className="fo-saved-report-name">{report.name}</span>
                    <span className="fo-muted fo-saved-report-meta">
                      Updated {new Date(report.updatedAt).toLocaleDateString()}
                    </span>
                    <span className="fo-btn-row">
                      <button type="button" className="fo-btn-secondary" onClick={() => onOpen(report)} aria-label={`Open ${report.name}`}>Open</button>
                      <button type="button" className="fo-btn-secondary" onClick={() => startRename(report)} aria-label={`Rename ${report.name}`}>Rename</button>
                      <button type="button" className="fo-btn-secondary" onClick={() => onDuplicate(report.id)} aria-label={`Duplicate ${report.name}`}>Duplicate</button>
                      {confirmingDeleteId === report.id ? (
                        <>
                          <button type="button" className="fo-btn-secondary fo-warning" onClick={() => onDelete(report.id)} aria-label={`Confirm delete ${report.name}`}>Confirm delete</button>
                          <button type="button" className="fo-btn-secondary" onClick={() => setConfirmingDeleteId(null)}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="fo-btn-secondary" onClick={() => setConfirmingDeleteId(report.id)} aria-label={`Delete ${report.name}`}>Delete</button>
                      )}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {openState && <OpenStatus openState={openState} onDismiss={() => setOpenState(null)} />}
      </div>
    </div>
  );
}

// The result of opening (revalidating) a saved report -- surfaced, never acted on (editing/running
// is unavailable). Safe copy only.
function OpenStatus({ openState, onDismiss }) {
  const { name, result } = openState;
  if (!result.openable) {
    return (
      <div className="fo-state fo-tone-warning" role="alert">
        <p className="fo-state-title">“{name}” can’t be opened</p>
        <p className="fo-state-message fo-muted">{result.reason}</p>
        <button type="button" className="fo-btn-secondary" onClick={onDismiss}>Dismiss</button>
      </div>
    );
  }
  const drift = describeReconciliation(result);
  const needsEditing = result.residualErrors.length > 0;
  return (
    <div className={`fo-state fo-tone-${drift || needsEditing ? "warning" : "info"}`} role="status" aria-live="polite">
      <p className="fo-state-title">Opened “{name}”</p>
      {drift && <p className="fo-warning fo-state-message">{drift}</p>}
      {needsEditing && (
        <p className="fo-warning fo-state-message">
          This report needs changes before it can run — some of its columns or options aren’t valid anymore.
        </p>
      )}
      {!drift && !needsEditing && (
        <p className="fo-muted fo-state-message">This report is still valid against the current data catalog.</p>
      )}
      <p className="fo-muted fo-state-message">Editing and running reports isn’t available yet.</p>
      <button type="button" className="fo-btn-secondary" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
