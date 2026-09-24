// ONE ACTION, NAMED THE WAY AN ADMINISTRATOR NAMES IT.
//
// ════════════════════ THE RULE THIS COMPONENT EXISTS TO HOLD ════════════════════
//
//   `fulfillment.coordinatedVisit.read`   is an implementation identifier
//   "Read Coordinated Visits"             is what an administrator is granting
//
// The canonical catalog carries BOTH for every governed action (`display_label` has been NOT NULL
// since migration 1761350400000), so a security screen never has to choose. It has to place them:
// the label is the row, the key is the audit detail beside it. A grid that led with the key would
// be asking the person approving access to read the code that implements it.
//
// The key is NOT hidden. "Which capability is that, exactly" is a real question during an audit or
// a support call, and a UI that made it unanswerable would push people back to the database.
//
// ════════════════════ WHAT THIS DOES NOT DO ════════════════════
//
// It renders. It holds no state, fetches nothing, and offers no control that would grant or revoke:
// the grant contract is objectKey + actionKey on the SERVER, and an affordance drawn here would be
// a client that looks able to decide access. No Administration screen or route mounts this in this
// tranche -- it is the assembly the later Object security slice is made of, proved renderable now.
import { UNLABELLED_ACTION } from "./objectSecurityReadModel.js";

/** "2 Roles · 1 Principal", or the fact an administrator came to find: nobody holds this at all. */
function granteeSummary(action) {
  const roles = Array.isArray(action.roleKeys) ? action.roleKeys.length : null;
  const principals = Array.isArray(action.principalIds) ? action.principalIds.length : null;
  if (roles === null && principals === null) return null;
  if ((roles ?? 0) + (principals ?? 0) === 0) return "Nobody holds this action";
  const parts = [];
  if (roles) parts.push(`${roles} ${roles === 1 ? "Role" : "Roles"}`);
  if (principals) parts.push(`${principals} ${principals === 1 ? "Principal" : "Principals"}`);
  return parts.join(" · ");
}

/**
 * One row: the action's name, how it is held, and the capability key kept for audit.
 *
 * An action the payload did not label is drawn as "Unlabelled action" rather than as its key. That
 * is a defect state, and the honest way to show a defect is to say the name is missing -- not to
 * substitute the identifier, and not to invent a name by humanising the action key, which would be
 * a second label vocabulary competing with the catalog's.
 */
export function ObjectSecurityActionRow({ action }) {
  const grantees = granteeSummary(action);
  return (
    <li className={`fo-security-action${action.granted === false ? " fo-security-action--ungranted" : ""}`}>
      <span className="fo-security-action__name" data-testid="action-name">
        {action.displayLabel || UNLABELLED_ACTION}
      </span>
      {action.sourceLabel ? (
        <span className="fo-security-action__source fo-muted">{action.sourceLabel}</span>
      ) : null}
      {grantees ? (
        <span className={`fo-security-action__grantees${action.granted ? "" : " fo-warning"}`}>{grantees}</span>
      ) : null}
      <code className="fo-security-action__key fo-muted" data-testid="action-capability-key">
        <span className="fo-sr-only">Capability key: </span>
        {action.capabilityKey ?? "—"}
      </code>
    </li>
  );
}

/**
 * The actions of one Object, one Role's Object, or one Principal's Object -- the read model gives
 * all three the same row shape, which is the point of having a read model.
 *
 * `actions` that is not an array renders NOTHING rather than an empty list: a refused or unread
 * security read must never reach a surface that looks like "there is nothing here".
 */
export function ObjectSecurityActionList({ actions, emptyMessage = "This Object governs no actions yet." }) {
  if (!Array.isArray(actions)) return null;
  if (actions.length === 0) return <p className="fo-muted fo-security-actions__empty">{emptyMessage}</p>;
  return (
    <ul className="fo-security-actions">
      {actions.map((action) => (
        <ObjectSecurityActionRow key={action.capabilityKey ?? action.actionKey} action={action} />
      ))}
    </ul>
  );
}

export default ObjectSecurityActionList;
