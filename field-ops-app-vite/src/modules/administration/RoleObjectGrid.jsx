import { OBJECT_PERMISSIONS, VERBS, VERB_LABEL, cellState } from "../../access/objectPermissionMap.js";

// THE CRED GRID FOR ONE ROLE -- Object x Create/Read/Edit/Delete.
//
// ONE IMPLEMENTATION, TWO PAGES. This markup existed twice: Objects rendered it as its "By role"
// view, and Roles & Permissions rendered a second copy under the heading "Business objects", from
// the same source data through a different helper. Two tables of the same facts drift -- they
// already had different cell affordances (a checkbox on one, a tick glyph on the other) and
// different accessible names for the same three states, so the same grant read differently
// depending on which page an administrator happened to be standing on. There is now one component
// and one set of words for each state.
//
// THREE CELL STATES, NOT TWO, and this is the reason the component exists rather than a bare
// <table>. Ticked = granted. Blank = not granted. A DASH = no capability governs this object/verb
// pair at all, so it can never be granted to anyone. Drawing that third state as an unticked box
// invites an administrator to go request access that does not exist to give -- the failure this
// grid was built to stop.
//
// READ-ONLY, AND SAYING SO IS THE CALLER'S JOB. The cells are inert because Role definitions live
// in code and the trusted commands grant ROLES TO PEOPLE, not permissions to roles. This component
// renders the grid and nothing else; each page states that fact in its own words, because the two
// pages are answering different questions around it.
function Cell({ state }) {
  if (state === "noCapability") {
    return (
      <span className="fo-muted" title="No capability exists for this verb — it cannot be granted to any role">
        —
      </span>
    );
  }
  return (
    <input
      type="checkbox"
      checked={state === "granted"}
      readOnly
      disabled
      aria-label={state === "granted" ? "Granted" : "Not granted"}
    />
  );
}

/**
 * @param role   A Role object from the access contracts. Required.
 * @param label  The role's display name, used for the table's accessible name so a screen reader
 *               reaching it out of order still learns whose grid this is.
 */
export default function RoleObjectGrid({ role, label }) {
  if (!role) return null;
  return (
    <div className="fo-table-scroll">
      <table className="fo-table" aria-label={`${label} object permissions`}>
        <thead>
          <tr>
            <th scope="col">Object</th>
            <th scope="col">Domain</th>
            {VERBS.map((v) => (
              <th key={v} scope="col" title={VERB_LABEL[v]}>
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {OBJECT_PERMISSIONS.map((entry) => (
            <tr key={entry.object}>
              <td>
                {entry.object}
                {/* Governed by firestore.rules rather than by the capability model. Said on the
                    row because the grid otherwise renders it as a normal object whose cells
                    happen to be empty, which is a different and wrong story. */}
                {/* NOT "rules-governed" any more. Rules decide nothing (Owner direction
                    2026-09-07), so an object that was governed only by firestore.rules is now
                    governed by NOTHING and denied outright. Saying "rules-governed" here would
                    describe an authority that no longer exists and imply the object is handled. */}
                {entry.rulesOnly && (
                  <span
                    className="fo-muted"
                    title={`No capability governs ${entry.rulesOnly} yet. firestore.rules used to decide it and no longer decides anything, so every action on it is denied until a capability is defined here.`}
                  >
                    {" "}
                    (no capability yet)
                  </span>
                )}
              </td>
              <td className="fo-muted">{entry.domain}</td>
              {VERBS.map((v) => (
                <td key={v}>
                  <Cell state={cellState(role, entry, v)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
