import { buildImportedServiceHistoryView, IMPORTED_HISTORY_STATE } from "../../domain/importedServiceHistoryView";

// IMPORTED HISTORICAL SERVICE -- the second source under Service activity.
//
// It sits BELOW the Work Order timeline, under its own heading, with its own state, and it is
// never interleaved with it. The reasoning is in domain/importedServiceHistoryView.js; the
// short version is that a Work Order row carries a status, a schedule and an assigned
// technician, and an imported row has none of those and never will. One merged list would put
// four empty cells beside every historical row and invite exactly the reading this exists to
// prevent -- that those are jobs EOS lost track of.
//
// EVERY ROW IS BADGED. The heading says it, the lede says it, and each row says it again,
// because a row is what gets screenshotted, pasted into an email and quoted back six months
// later with no heading attached.
//
// NOTHING IS RESOLVED. The technician is text a former system recorded and is labelled that
// way; so is the equipment serial. Neither is linked, and neither is presented as though EOS
// knows who or what it refers to.
//
// STYLING reuses the `ns-svc__` row grammar the Work Order list above already uses, so the two
// sources read as the same page. The only new rules are the badge and the historical row's own
// column split -- an imported row has different columns because it has different facts.

function Row({ row }) {
  return (
    <li className="ns-svc__row ns-svc__row--imported">
      <span className="ns-svc__ref">
        {row.reference}
        <span className="ns-imported-badge">{row.label}</span>
      </span>
      <span className="ns-svc__summary">{row.summary}</span>
      <span className="ns-svc__when">{row.serviceDate}</span>
      <span className="ns-svc__who">
        {/* "As recorded" is the honest description: this is text, it was never resolved to an
            EOS employee, and the canonical model does not prove that identity. */}
        {row.technician ? `${row.technician} (as recorded)` : "Technician not recorded"}
      </span>
    </li>
  );
}

export default function ImportedServiceHistoryBlock({ loading = false, source = null }) {
  const view = buildImportedServiceHistoryView({ loading, source });

  // INERT and EMPTY render NOTHING. A customer with no imported history is the normal case, and
  // a permanent "no imported history" line on every customer page is noise about a migration
  // that is over.
  if (view.state === IMPORTED_HISTORY_STATE.INERT || view.state === IMPORTED_HISTORY_STATE.EMPTY) {
    return null;
  }

  return (
    <div className="ns-imported-history" aria-label="Imported historical service">
      <div className="ns-section__head">
        <h3 className="ns-section__title ns-imported-history__title">
          {view.heading ?? "Imported historical service"}
        </h3>
      </div>

      {view.state === IMPORTED_HISTORY_STATE.LOADING ? (
        <p className="ns-state">Loading imported historical service…</p>
      ) : view.state === IMPORTED_HISTORY_STATE.DENIED ? (
        // Not "none", not "failed" -- a third answer, because the thing to go and fix differs.
        <p className="ns-state ns-state--denied">Imported historical service is not available to you.</p>
      ) : view.state === IMPORTED_HISTORY_STATE.ERROR ? (
        <p className="ns-state ns-state--error">Imported historical service couldn’t be read. Try again later.</p>
      ) : (
        <>
          <p className="ns-table__note">{view.lede}</p>
          <ul className="ns-svc__list">
            {view.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
          {view.truncated ? (
            <p className="ns-table__note">
              Only the most recent records are shown. The full imported history is not paged here.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
