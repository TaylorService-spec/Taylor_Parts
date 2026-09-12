import { useState } from "react";
import { cellState } from "../../access/objectPermissionMap.js";
import { GOVERNABLE_OBJECTS, governedVerbs } from "../../access/policyObjectRegistry.js";
import {
  CELL_STATE,
  INHERITANCE,
  INHERITANCE_LABEL,
  STATE_LABEL,
  VERBS,
  VERB_LABEL,
  buildFieldRow,
  buildObjectRow,
} from "../../domain/adminPolicyView.js";

// THE ROLE POLICY GRID -- Object x CRED, with the object's FIELDS underneath.
//
// ════════════════════ WHAT THIS ADDS TO RoleObjectGrid ════════════════════
//
// The same object matrix, plus the expand caret the Owner's model calls for: open Customer and see
// Name, Address, Payment Terms, Tax Status with their own CRED. That is the question an
// administrator actually arrives with -- "can this role see the credit limit" -- and until now the
// product had no surface that could answer it at all.
//
// ════════════════════ WHERE EACH NUMBER COMES FROM ════════════════════
//
//   OBJECT LIST   policyObjectRegistry.js -- the UNION of the CRUD matrix and the metadata
//                 registry, which is the same list the policy seed writes. It used to be the matrix
//                 alone, and thirteen entities carrying 166 fields (Supplier, Warehouse, Truck,
//                 Reorder Request, Sales Agreement and eight more) appeared on no Administration
//                 screen at all. 36 objects now, not 24.
//   OBJECT CRED   the capability model, exactly as before for the matrix rows. An object no
//                 capability governs shows a dash on every verb -- it exists and is real, and
//                 nothing can be granted on it yet.
//   FIELD CRED    INHERITED from the object, because that is the truth today: field-level policy
//                 lives in the EOS policy store, and until that store is stood up there are no
//                 overrides for any Role. Every field row is therefore drawn as inherited, which is
//                 not a placeholder -- it is what the system currently does.
//   FIELD LIST    the metadata registry: 28 entities, 389 declared fields, the same definitions the
//                 record pages render from. Not a second field model.
//
// WHEN THE POLICY STORE ARRIVES, the only change here is that `override` stops being null. The
// view model already draws overridden and blocked-by-object states; they simply have nothing to
// draw yet, and the legend says so rather than pretending the capability is missing.
//
// ════════════════════ READ-ONLY, AND SAYING WHY ════════════════════
//
// Role definitions still live in code. The cells are inert because editing them is a POLICY-STORE
// operation, and the trusted commands that perform it (functions/src/adminPolicy/policyCommands.ts)
// have no store behind them yet. A control that cannot act still reads as an affordance, so none is
// drawn -- the caller states the reason in its own words.

/**
 * Does this Role hold any capability for this object/verb?
 *
 * `cellState` reads a CRUD-matrix row. The union carries the same shape -- `capabilitiesByVerb` --
 * for every object including the ones the matrix never had a row for, so one function answers both.
 */
function grantedFor(role, object, verb) {
  return cellState(role, object.capabilitiesByVerb, verb) === "granted";
}

function Cell({ cell }) {
  if (cell.state === CELL_STATE.UNAVAILABLE) {
    return <span className="fo-muted" title={STATE_LABEL[CELL_STATE.UNAVAILABLE]}>—</span>;
  }
  if (cell.state === CELL_STATE.BLOCKED_BY_OBJECT) {
    // Set on the field, overruled by the object. Drawn distinctly because an administrator who set
    // it needs to know it did nothing -- otherwise they keep not-fixing it, because it looks right.
    return <span className="fo-warning" title={STATE_LABEL[CELL_STATE.BLOCKED_BY_OBJECT]} aria-label="Blocked by the object">⊘</span>;
  }
  const granted = cell.state === CELL_STATE.GRANTED;
  const inherited = cell.inheritance === INHERITANCE.INHERITED;
  return (
    <input
      type="checkbox"
      checked={granted}
      readOnly
      disabled
      // The accessible name carries the INHERITANCE too, because a sighted reader gets it from the
      // row's styling and a screen-reader user would otherwise get a grid of identical checkboxes.
      aria-label={
        cell.inheritance
          ? `${STATE_LABEL[granted ? CELL_STATE.GRANTED : CELL_STATE.DENIED]}, ${INHERITANCE_LABEL[cell.inheritance]}`
          : STATE_LABEL[granted ? CELL_STATE.GRANTED : CELL_STATE.DENIED]
      }
      title={inherited ? INHERITANCE_LABEL[INHERITANCE.INHERITED] : INHERITANCE_LABEL[INHERITANCE.OVERRIDDEN]}
    />
  );
}

/**
 * @param role   a Role from the access contracts
 * @param label  the role's display name, used for the table's accessible name
 */
export default function RolePolicyGrid({ role, label }) {
  const [expanded, setExpanded] = useState(() => new Set());
  if (!role) return null;

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="fo-table-scroll">
      <table className="fo-table" aria-label={`${label} object and field permissions`}>
        <thead>
          <tr>
            <th scope="col">Object</th>
            <th scope="col">Domain</th>
            {VERBS.map((v) => (
              <th key={v} scope="col" title={VERB_LABEL[v]}>{v}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GOVERNABLE_OBJECTS.map((entry) => {
            const cred = {};
            for (const verb of VERBS) cred[verb] = grantedFor(role, entry, verb);
            const governed = governedVerbs(entry);
            const objectRow = buildObjectRow({
              key: entry.key,
              label: entry.label,
              domain: entry.domain,
              cred,
              governed,
            });

            // `displayable: false` fields are declared so their meaning is recorded but are not
            // offered as columns, and a permissions grid is a column list.
            const fields = entry.fields.filter((field) => field.displayable !== false);
            const isOpen = expanded.has(entry.key);

            return [
              <tr key={entry.key}>
                <td>
                  {fields.length > 0 ? (
                    <button
                      type="button"
                      className="fo-caret"
                      onClick={() => toggle(entry.key)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} the ${fields.length} fields of ${entry.label}`}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  ) : (
                    // No declared fields is a REAL state, not a missing caret. An object with no
                    // metadata definition cannot show a field list, and drawing a caret that opens
                    // nothing would say it could.
                    <span className="fo-caret-placeholder" aria-hidden="true" />
                  )}{" "}
                  {entry.label}
                  {entry.rulesOnly && (
                    <span className="fo-muted" title={`Governed by firestore.rules on ${entry.rulesOnly}, outside the capability model`}>
                      {" "}(rules-governed)
                    </span>
                  )}
                  {fields.length > 0 && (
                    <span className="fo-muted"> · {fields.length} fields</span>
                  )}
                </td>
                {/* An entity the CRUD matrix never carried has no business domain to show. Blank
                    rather than guessed, so an empty cell reads as "not stated". */}
                <td className="fo-muted">{entry.domain ?? "—"}</td>
                {VERBS.map((v) => (
                  <td key={v}><Cell cell={objectRow.cells[v]} /></td>
                ))}
              </tr>,
              ...(isOpen
                ? fields.map((field) => {
                    // No override exists for any Role until the policy store is stood up, so every
                    // field is genuinely inherited. `override: null` is the honest value, not a stub.
                    const fieldRow = buildFieldRow({
                      key: field.id,
                      label: field.label,
                      effective: cred,
                      objectCred: cred,
                      override: null,
                      // The object's ungoverned verbs are ungoverned for its fields too. Without
                      // this a field showed Delete as an empty checkbox while its object showed a
                      // dash -- inviting a request for access no capability can grant.
                      governed,
                    });
                    return (
                      <tr key={`${entry.key}:${field.id}`} className="fo-row-nested">
                        <td className="fo-nested-label">
                          <span className="fo-muted">↳</span> {field.label}
                          <span className="fo-muted"> · {field.type}</span>
                        </td>
                        <td className="fo-muted">inherited</td>
                        {VERBS.map((v) => (
                          <td key={v}><Cell cell={fieldRow.cells[v]} /></td>
                        ))}
                      </tr>
                    );
                  })
                : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
