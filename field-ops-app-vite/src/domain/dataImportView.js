// Administration -> Data Import -- the PURE view model.
//
// No React, no firebase, no DOM. The screen renders what this returns; this decides what
// the screen is allowed to say. Separated for the reason every view model in this codebase
// is: the interesting rules here are about what an operator is told, and those are worth
// testing without mounting anything.
//
// THE RULE THIS FILE EXISTS TO KEEP. An import screen has several ways to be empty and they
// mean completely different things -- not authorized, no file chosen, a file with no
// mappable columns, a file whose every row failed. Rendering any of them as "nothing to
// import" is the failure mode; each gets its own state and its own sentence.

export const IMPORT_STAGE = Object.freeze({
  UNGATED: "UNGATED",
  IDLE: "IDLE",
  STAGING: "STAGING",
  MAPPING_INCOMPLETE: "MAPPING_INCOMPLETE",
  PREVIEWED: "PREVIEWED",
  EXECUTING: "EXECUTING",
  DONE: "DONE",
  FAILED: "FAILED",
});

export function buildDataImportView({
  canStage = false,
  canExecute = false,
  busy = false,
  staged = null,
  result = null,
  error = null,
} = {}) {
  if (!canStage) {
    return {
      stage: IMPORT_STAGE.UNGATED,
      canExecute: false,
      headline: "Data Import is not available to you.",
      // Naming the capability is deliberate: an admin who cannot use this screen needs to
      // know what to ask for, and "contact your administrator" is what this screen IS.
      detail: "It needs admin.dataImport.stage, which is not active in this environment or not granted to your role.",
    };
  }

  if (error) {
    return {
      stage: IMPORT_STAGE.FAILED,
      canExecute,
      headline: "The import could not continue.",
      detail: error.message,
      code: error.code ?? null,
    };
  }

  if (result) {
    const { created = 0, replayed = 0, failed = 0 } = result.result ?? {};
    return {
      stage: IMPORT_STAGE.DONE,
      canExecute,
      headline:
        failed === 0
          ? `Imported ${created + replayed} record${created + replayed === 1 ? "" : "s"}.`
          : `Imported ${created + replayed}, and ${failed} row${failed === 1 ? "" : "s"} could not be written.`,
      // A partial import is reported as a partial import. Rounding it up to success is how
      // an operator finds out six weeks later that a supplier's Parts are missing.
      detail:
        failed === 0
          ? "Every approved row was written."
          : "The rows that failed are listed below with the reason each one was refused.",
      result,
    };
  }

  if (busy) {
    return {
      stage: staged ? IMPORT_STAGE.EXECUTING : IMPORT_STAGE.STAGING,
      canExecute,
      headline: staged ? "Writing the approved rows..." : "Reading and checking the file...",
      detail: staged ? "Do not close this tab." : "Nothing has been written yet.",
    };
  }

  if (!staged) {
    return {
      stage: IMPORT_STAGE.IDLE,
      canExecute,
      headline: "Choose a file to import.",
      detail: "The file is read, mapped and checked first. Nothing is written until you approve the preview.",
    };
  }

  if (staged.staged === false) {
    return {
      stage: IMPORT_STAGE.MAPPING_INCOMPLETE,
      canExecute,
      headline: "This file cannot be imported as mapped.",
      detail: "Required fields have no column. Map them below, or export the file again with those columns.",
      validation: staged.validation ?? null,
      suggestions: staged.suggestions ?? [],
    };
  }

  const job = staged.job;
  const summary = job?.summary ?? { total: 0, ready: 0, warnings: 0, errors: 0 };
  const importable = summary.ready + summary.warnings;

  return {
    stage: IMPORT_STAGE.PREVIEWED,
    canExecute,
    job,
    summary,
    importable,
    headline:
      importable === 0
        ? "No row in this file can be imported."
        : `${importable} of ${summary.total} row${summary.total === 1 ? "" : "s"} will be imported.`,
    detail:
      summary.errors === 0
        ? "Nothing has been written yet. Approve to write these records."
        : `${summary.errors} row${summary.errors === 1 ? " is" : "s are"} shown but will not be written.`,
    consequence:
      APPROVAL_CONSEQUENCE[job?.entityType] ??
      "Approving writes the records shown above. It never overwrites an existing record.",
    // Approving is gated on the SECOND capability, and the reason is stated rather than the
    // button silently vanishing -- a control that disappears reads as a missing feature.
    approvalBlockedReason: !canExecute
      ? "Approving an import needs admin.dataImport.execute, which you do not hold."
      : importable === 0
        ? "There is nothing to approve."
        : null,
  };
}

/**
 * What approving this import will actually do, in one sentence, per entity.
 *
 * IT LIVES HERE RATHER THAN ON THE SCREEN because the sentences are not decoration -- each
 * one names a real difference in what the write means. A Part lands in DRAFT because a
 * spreadsheet cannot substantiate ACTIVE. An opening balance writes a ledger movement rather
 * than a stored number. A service record is explicitly not a Work Order. An operator
 * approving a bulk write is entitled to know which of those they are about to do, and a
 * screen that said "writes the records shown above" for all five would be telling four of
 * them something slightly untrue.
 */
export const APPROVAL_CONSEQUENCE = Object.freeze({
  PARTS: "Approving creates these as new Parts in DRAFT status. Activating a Part stays a separate step.",
  CUSTOMERS:
    "Approving creates these as new Customers. Payment terms and tax status are not imported and stay unset.",
  EQUIPMENT:
    "Approving creates these as ACTIVE Equipment under the customer and location each row names.",
  INVENTORY:
    "Approving records an opening balance for each row -- one ledger movement, at a position with no history yet. It is not a receipt and not a count correction.",
  SERVICE_HISTORY:
    "Approving records these as historical service performed in another system. They are not Work Orders and nothing is scheduled.",
});

/** Row tone for the preview table. One vocabulary, shared with the rest of the app. */
export function rowTone(classification) {
  if (classification === "ERROR") return "critical";
  if (classification === "WARNING") return "attention";
  return "positive";
}
