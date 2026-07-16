import { useCallback, useMemo, useRef, useState } from "react";
import Modal from "../../shared/ui/Modal";
import {
  parseCsv,
  suggestMapping,
  validateMapping,
  validateRows,
  contactImportErrorMessage,
  MALFORMED_FILE_MESSAGE,
  SUPPORTED_CONTACT_FIELDS,
  MAX_IMPORT_ROWS,
} from "../../domain/contactCsvImport";
import { importContacts } from "../../domain/contactImport";

// Customer Contact CSV import (Issue #209). An accessible, three-step flow inside
// the shared PR #201 Modal: select a .csv, map columns to the supported Contact
// fields (auto-suggested, manually adjustable), then validate + preview accepted/
// skipped-duplicate/rejected rows and confirm. Accepted rows are written in ONE
// atomic client writeBatch (domain/contactImport.js) -- authenticated client +
// Rules only, all-or-nothing. The account is fixed by context and is never a
// mappable CSV column. Reuses the already-loaded `existingContacts` for duplicate
// detection -- no per-row/per-contact reads.

const PREVIEW_ROWS = 5;

export default function ContactImportModal({ accountId, accountName, existingContacts = [], onClose, onImported }) {
  const [step, setStep] = useState("select"); // select | map | preview
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState({ headers: [], rows: [] });
  const [parseError, setParseError] = useState("");
  const [mapping, setMapping] = useState({});
  const [validation, setValidation] = useState(null);
  const [importing, setImporting] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fileInputRef = useRef(null);
  // Read synchronously by requestClose, which runs from Modal's keydown/backdrop handlers
  // -- a ref, not the `importing` state, because those handlers must see the CURRENT
  // in-flight status, not whatever was captured when they were bound. The sibling create
  // modals (LocationCreateModal / ContactCreateModal) use exactly this pattern.
  const importingRef = useRef(false);

  const mappingCheck = useMemo(() => validateMapping(mapping), [mapping]);

  // CLOSE-DURING-IMPORT PROTECTION (#298). Escape, the ✕ control, and a backdrop click
  // all reach the modal through onClose; a close WHILE a write is committing is ignored,
  // so the modal cannot vanish before its own result is known. Contact CSV import is a
  // bulk, atomic writeBatch -- losing its UI mid-commit would leave the user with no
  // result, no error, and no way to tell whether their rows landed. Every other create
  // modal already guards this; this one passed onClose straight through.
  const requestClose = useCallback(() => {
    if (importingRef.current) return;
    onClose();
  }, [onClose]);

  async function handleFile(e) {
    setParseError("");
    setSaveError("");
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    let text = "";
    try {
      text = await file.text();
    } catch {
      setParseError("Could not read the selected file. Please choose a valid .csv file.");
      return;
    }
    const result = parseCsv(text);
    // Structurally malformed (unclosed quote, ragged record, stray quote, etc.):
    // reject the whole file with fixed, actionable copy -- never surface raw
    // parser content or row data, stay on this step (import stays unavailable).
    if (!result.ok) {
      setParseError(MALFORMED_FILE_MESSAGE);
      setParsed({ headers: [], rows: [] });
      return;
    }
    if (result.headers.length === 0 || result.rows.length === 0) {
      setParseError("This file has no header row and data rows to import.");
      setParsed({ headers: [], rows: [] });
      return;
    }
    setParsed({ headers: result.headers, rows: result.rows });
    setMapping(suggestMapping(result.headers));
    setValidation(null);
    setStep("map");
  }

  function setFieldColumn(fieldKey, value) {
    setMapping((cur) => {
      const next = { ...cur };
      if (value === "") delete next[fieldKey];
      else next[fieldKey] = Number(value);
      return next;
    });
    setValidation(null);
  }

  function handleValidate() {
    if (!mappingCheck.valid) return;
    setValidation(validateRows(parsed.rows, mapping, existingContacts, { maxRows: MAX_IMPORT_ROWS }));
    setStep("preview");
  }

  async function handleConfirm() {
    if (!validation || validation.overLimit || validation.accepted.length === 0) return;
    if (importingRef.current) return; // duplicate-submit guard: one commit at a time
    importingRef.current = true;
    setImporting(true);
    setSaveError("");
    try {
      const result = await importContacts(accountId, validation.accepted.map((a) => a.contact));
      if (result?.blocked) {
        const e = new Error("blocked");
        e.blocked = true;
        throw e;
      }
      // Success: hand the caller the totals + first imported id so it can announce
      // and move focus once the live subscription renders the new rows.
      onImported?.({
        importedIds: result.ids,
        importedCount: result.ids.length,
        skippedDuplicates: validation.rejected.filter((r) => /duplicate/i.test(r.reason)).length,
        rejected: validation.rejected.length,
        firstName: validation.accepted[0]?.contact.name,
      });
    } catch (err) {
      // Keep the modal open; show safe copy (never a raw Firebase detail).
      console.error("Contact import failed:", err);
      setSaveError(contactImportErrorMessage(err));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }

  const dupCount = validation ? validation.rejected.filter((r) => /duplicate/i.test(r.reason)).length : 0;
  const otherRejected = validation ? validation.rejected.filter((r) => !/duplicate/i.test(r.reason)) : [];

  return (
    <Modal title="Import Contacts" onClose={requestClose}>
      <div className="fo-contact-import">
        <p className="fo-muted fo-contact-import-context">
          Importing into: <strong>{accountName}</strong> (the customer is fixed and cannot be changed from the CSV).
        </p>

        {/* Live status region -- announces the current step / totals. */}
        <p className="fo-sr-only" role="status" aria-live="polite">
          {step === "select" && "Choose a CSV file to import contacts."}
          {step === "map" && "Map your CSV columns to contact fields, then validate."}
          {step === "preview" && validation &&
            (validation.overLimit
              ? `File has ${validation.dataRowCount} rows, over the ${validation.limit}-row limit.`
              : `${validation.accepted.length} to import, ${dupCount} duplicates skipped, ${otherRejected.length} rejected.`)}
        </p>

        {/* ===== Step 1: select ===== */}
        {step === "select" && (
          <div className="fo-wizard-field">
            <label className="fo-wizard-field-label" htmlFor="contact-csv-file">CSV file</label>
            <input
              id="contact-csv-file"
              ref={fileInputRef}
              className="fo-wizard-control"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
            />
            <p className="fo-muted">
              Supported columns: Name (required), Email, Phone, Role. Up to {MAX_IMPORT_ROWS} rows per import.
            </p>
            {parseError && <div className="fo-warning" role="alert">{parseError}</div>}
          </div>
        )}

        {/* ===== Step 2: map ===== */}
        {step === "map" && (
          <>
            <p className="fo-muted">File: {fileName}</p>
            <div className="fo-contact-import-map">
              {SUPPORTED_CONTACT_FIELDS.map((f) => (
                <div className="fo-wizard-field" key={f.key}>
                  <label className="fo-wizard-field-label" htmlFor={`map-${f.key}`}>
                    {f.label}{f.required ? " (required)" : ""}
                  </label>
                  <select
                    id={`map-${f.key}`}
                    className="fo-wizard-control"
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setFieldColumn(f.key, e.target.value)}
                  >
                    <option value="">— not mapped —</option>
                    {parsed.headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {!mappingCheck.valid && (
              <div className="fo-warning" role="alert">
                <ul className="fo-contact-import-errors">
                  {mappingCheck.errors.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              </div>
            )}

            {/* Header + representative-row preview */}
            <div className="fo-table-scroll fo-contact-import-preview">
              <table className="fo-table">
                <thead>
                  <tr>{parsed.headers.map((h, i) => <th key={i}>{h || `Column ${i + 1}`}</th>)}</tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, PREVIEW_ROWS).map((row, ri) => (
                    <tr key={ri}>{parsed.headers.map((_, ci) => <td key={ci}>{row[ci] ?? ""}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fo-wizard-actions">
              <button type="button" onClick={() => setStep("select")}>Back</button>
              <button type="button" disabled={!mappingCheck.valid} onClick={handleValidate}>Validate</button>
            </div>
          </>
        )}

        {/* ===== Step 3: preview + confirm ===== */}
        {step === "preview" && validation && (
          <>
            {validation.overLimit ? (
              <div className="fo-warning" role="alert">
                This file has {validation.dataRowCount} data rows, over the {validation.limit}-row limit. Split it into
                smaller files and import again. Nothing was imported.
              </div>
            ) : (
              <dl className="fo-wizard-review fo-contact-import-summary">
                <dt>To import</dt>
                <dd>{validation.accepted.length}</dd>
                <dt>Skipped (duplicates)</dt>
                <dd>{dupCount}</dd>
                <dt>Rejected</dt>
                <dd>{otherRejected.length}</dd>
              </dl>
            )}

            {otherRejected.length > 0 && (
              <div className="fo-contact-import-rejected">
                <p className="fo-muted">Rejected rows (not imported):</p>
                <ul className="fo-contact-import-errors">
                  {otherRejected.slice(0, 10).map((r, i) => (
                    <li key={i}>Row {r.rowNumber}: {r.reason}</li>
                  ))}
                  {otherRejected.length > 10 && <li>…and {otherRejected.length - 10} more</li>}
                </ul>
              </div>
            )}

            {saveError && <div className="fo-warning fo-contact-import-save-error" role="alert">{saveError}</div>}

            <div className="fo-wizard-actions">
              <button type="button" onClick={() => setStep("map")} disabled={importing}>Back</button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={importing || validation.overLimit || validation.accepted.length === 0}
              >
                {importing ? "Importing…" : `Import ${validation.accepted.length} contact${validation.accepted.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
