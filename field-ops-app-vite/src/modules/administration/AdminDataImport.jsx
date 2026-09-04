import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader, StatusIndicator, Button } from "../../shared/ui/primitives";
import { buildDataImportView, rowTone, IMPORT_STAGE } from "../../domain/dataImportView";
import {
  stageDataImport,
  executeDataImport,
  listDataImportJobs,
  readFileText,
  readFileBase64,
  isWorkbookFile,
} from "../../access/dataImportClient";

// Administration -> Data Import.
//
// The whole flow on one screen, in the order it actually happens: choose a file, see what
// the system understood, see what it would do, approve it, see what it did. There is no
// wizard chrome, because the steps are not independent -- the preview IS the thing being
// approved, and putting it on a separate step would let someone approve a screen they had
// scrolled past.
//
// ============================ WHAT THIS SCREEN IS NOT ALLOWED TO DO ============================
//
// It does not parse the file, validate a row, decide an entity, or write anything. It sends
// text and receives a decision. A browser-side preview would be a DIFFERENT preview from the
// one the backend executes, and the approval would then attach to a document nobody checked.
//
// ============================ THE STATES, AND WHY EACH IS ITS OWN ============================
//
// Not authorized / no file / unmappable file / nothing importable / partial success are five
// different facts that all look like "empty" if you let them. domain/dataImportView.js keeps
// them apart and this file only renders what it is given.
//
// ROWS THAT FAILED ARE SHOWN, never filtered. An import that quietly drops the rows it could
// not handle is worse than one that refuses the file: the operator believes it worked.

const CAP_STAGE = "admin.dataImport.stage";
const CAP_EXECUTE = "admin.dataImport.execute";

function Findings({ findings }) {
  if (!findings?.length) return null;
  return (
    <ul className="fo-data-import__findings">
      {findings.map((f, i) => (
        <li key={`${f.field}-${f.code}-${i}`}>
          <StatusIndicator tone={f.severity === "ERROR" ? "critical" : "attention"} label={f.message} />
        </li>
      ))}
    </ul>
  );
}

function PreviewTable({ rows }) {
  return (
    <div className="fo-data-import__preview">
      <table className="fo-table">
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Identity</th>
            <th scope="col">Outcome</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sourceRowNumber}>
              <td className="fo-tabular-nums">{row.sourceRowNumber}</td>
              <td>{row.identity ?? <span className="fo-muted">could not be read</span>}</td>
              <td>
                <StatusIndicator
                  tone={rowTone(row.classification)}
                  label={row.classification === "ERROR" ? "Will not import" : row.classification === "WARNING" ? "Will import" : "Will import"}
                />
              </td>
              <td>
                {row.findings?.length ? <Findings findings={row.findings} /> : <span className="fo-muted">-</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultTable({ rows }) {
  const failed = rows.filter((r) => r.outcome === "failed");
  if (failed.length === 0) return null;
  return (
    <div className="fo-data-import__preview">
      <table className="fo-table">
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Identity</th>
            <th scope="col">Why it was refused</th>
          </tr>
        </thead>
        <tbody>
          {failed.map((r) => (
            <tr key={r.sourceRowNumber}>
              <td className="fo-tabular-nums">{r.sourceRowNumber}</td>
              <td>{r.identity ?? <span className="fo-muted">-</span>}</td>
              <td>{r.failureMessage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ jobs }) {
  if (!jobs.length) {
    return <p className="fo-muted">No import has been run in this environment yet.</p>;
  }
  return (
    <table className="fo-table">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">File</th>
          <th scope="col">Entity</th>
          <th scope="col">Status</th>
          <th scope="col">Written</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.jobId}>
            <td>{new Date(job.stagedAt).toLocaleString()}</td>
            <td>{job.fileName}</td>
            <td>{job.entityType}</td>
            <td>{job.status.replace(/_/g, " ").toLowerCase()}</td>
            <td className="fo-tabular-nums">
              {job.result ? job.result.created + job.result.replayed : 0}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminDataImport({ hasCapability }) {
  const canStage = typeof hasCapability === "function" && hasCapability(CAP_STAGE) === true;
  const canExecute = typeof hasCapability === "function" && hasCapability(CAP_EXECUTE) === true;

  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [jobs, setJobs] = useState([]);

  const refreshHistory = useCallback(async () => {
    if (!canStage) return;
    const res = await listDataImportJobs();
    setJobs(res.ok && Array.isArray(res.data?.jobs) ? res.data.jobs : []);
  }, [canStage]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const onFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    // Clearing the input is what lets the same file be chosen twice in a row -- without it
    // a corrected re-export with the same filename silently does nothing.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setResult(null);
    setStaged(null);
    setBusy(true);
    try {
      // A workbook is binary and a CSV is text; reading either one the other way
      // corrupts it in the browser, before anything that could report it honestly.
      const res = isWorkbookFile(file.name)
        ? await stageDataImport({ fileName: file.name, fileBase64: await readFileBase64(file) })
        : await stageDataImport({ fileName: file.name, fileText: await readFileText(file) });
      if (res.ok) setStaged(res.data);
      else setError(res);
    } catch (err) {
      setError({ code: "READ_FAILED", message: err?.message ?? "The file could not be read." });
    } finally {
      setBusy(false);
    }
  }, []);

  const onApprove = useCallback(async () => {
    const jobId = staged?.job?.jobId;
    if (!jobId) return;
    setBusy(true);
    setError(null);
    const res = await executeDataImport(jobId);
    setBusy(false);
    if (res.ok) {
      setResult(res.data.job);
      setStaged(null);
    } else {
      setError(res);
    }
    refreshHistory();
  }, [staged, refreshHistory]);

  const onReset = useCallback(() => {
    setStaged(null);
    setResult(null);
    setError(null);
  }, []);

  const view = buildDataImportView({ canStage, canExecute, busy, staged, result, error });

  return (
    <div className="fo-data-import">
      <PageHeader
        title="Data Import"
        subtitle="Load Parts, Customers, Equipment, Inventory and Service History from a CSV or Excel file."
      />

      {view.stage === IMPORT_STAGE.UNGATED ? (
        <div className="fo-panel">
          <StatusIndicator tone="neutral" label={view.headline} />
          <p className="fo-wizard-hint">{view.detail}</p>
        </div>
      ) : (
        <>
          <div className="fo-panel">
            <SectionHeader title="1. Choose a file" />
            <p className="fo-wizard-hint">{view.stage === IMPORT_STAGE.IDLE ? view.detail : "Choosing another file discards the current preview."}</p>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFile}
              disabled={busy}
              aria-label="Import file"
            />
          </div>

          {view.stage === IMPORT_STAGE.STAGING || view.stage === IMPORT_STAGE.EXECUTING ? (
            <div className="fo-panel">
              <StatusIndicator tone="info" label={view.headline} />
              <p className="fo-wizard-hint">{view.detail}</p>
            </div>
          ) : null}

          {view.stage === IMPORT_STAGE.FAILED ? (
            <div className="fo-panel">
              <StatusIndicator tone="critical" label={view.headline} />
              <p className="fo-wizard-hint">{view.detail}</p>
              <Button variant="secondary" onClick={onReset}>Start over</Button>
            </div>
          ) : null}

          {view.stage === IMPORT_STAGE.MAPPING_INCOMPLETE ? (
            <div className="fo-panel">
              <SectionHeader title="2. Columns" />
              <StatusIndicator tone="critical" label={view.headline} />
              <p className="fo-wizard-hint">{view.detail}</p>
              <Findings findings={view.validation?.findings ?? []} />
            </div>
          ) : null}

          {view.stage === IMPORT_STAGE.PREVIEWED ? (
            <>
              <div className="fo-panel">
                <SectionHeader title="2. What this file contains" />
                <p className="fo-data-import__summary">
                  <strong>{view.job.entityType}</strong> from <strong>{view.job.fileName}</strong>.{" "}
                  {Object.keys(view.job.mapping).length} column
                  {Object.keys(view.job.mapping).length === 1 ? "" : "s"} mapped.
                </p>
              </div>

              <div className="fo-panel">
                <SectionHeader title="3. Preview" />
                <StatusIndicator tone={view.summary.errors ? "attention" : "positive"} label={view.headline} />
                <p className="fo-wizard-hint">{view.detail}</p>
                <PreviewTable rows={view.job.rows} />
              </div>

              <div className="fo-panel">
                <SectionHeader title="4. Approve" />
                {view.approvalBlockedReason ? (
                  <Button variant="protected" reason={view.approvalBlockedReason}>
                    Approve and import
                  </Button>
                ) : (
                  <Button variant="primary" onClick={onApprove} loading={busy}>
                    Approve and import {view.importable} record{view.importable === 1 ? "" : "s"}
                  </Button>
                )}
                <p className="fo-wizard-hint">
                  Approving writes the records shown above as new Parts in DRAFT status. It never
                  overwrites an existing record.
                </p>
              </div>
            </>
          ) : null}

          {view.stage === IMPORT_STAGE.DONE ? (
            <div className="fo-panel">
              <SectionHeader title="Result" />
              <StatusIndicator
                tone={view.result.result?.failed ? "attention" : "positive"}
                label={view.headline}
              />
              <p className="fo-wizard-hint">{view.detail}</p>
              <ResultTable rows={view.result.result?.rows ?? []} />
              <Button variant="secondary" onClick={onReset}>Import another file</Button>
            </div>
          ) : null}

          <div className="fo-panel">
            <SectionHeader title="Import history" />
            <History jobs={jobs} />
          </div>
        </>
      )}
    </div>
  );
}
