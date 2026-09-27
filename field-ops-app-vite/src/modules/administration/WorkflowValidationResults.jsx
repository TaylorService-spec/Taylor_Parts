// The server's workflow validation findings (validateWorkflowVersion), grouped by code, verbatim.
// ERRORS block publication; WARNINGS never do. Nothing is decided here.
import { ReadState } from "./ObjectActionSecurity.jsx";

export default function ValidationResults({ read, summary }) {
  return (
    <div className="fo-cp-section" aria-label="Validation">
      <h4>Validation</h4>
      {!read.data ? <ReadState read={read} what="the validation results" /> : null}
      {read.data && !summary ? <p className="fo-warning" role="alert">The server returned validation results this screen cannot read.</p> : null}
      {summary ? (
        <div data-validation={summary.valid ? "VALID" : "INVALID"}>
          <p className={summary.valid ? "fo-muted" : "fo-warning"}>
            {summary.valid
              ? `Publishable: no errors${summary.warningCount ? `, ${summary.warningCount} warning(s)` : ""}.`
              : `Not publishable: ${summary.errorCount} error(s). Publishing is refused until each is resolved.`}
          </p>
          {[...summary.errors.map((g) => ({ ...g, severity: "ERROR" })), ...summary.warnings.map((g) => ({ ...g, severity: "WARNING" }))].map((g) => (
            <div key={`${g.severity}-${g.code}`} data-validation-code={g.code} data-validation-severity={g.severity}>
              <strong>{g.severity === "ERROR" ? "Error" : "Warning"} {g.code}</strong>
              <ul>
                {g.items.map((i, n) => <li key={n}>{i.message}</li>)}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
