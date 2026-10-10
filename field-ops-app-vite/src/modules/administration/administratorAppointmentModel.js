// The pure half of the Administrator checkbox (DECISIONS #223, PR-6) -- no React, node-testable.
//
// The designated Administrator is the Role whose key is `admin` AND which the server marks `protected` in its listRoles
// read -- never matched by display name. "Held" means an ACTIVE, GLOBAL assignment of exactly that Role in the server's
// listPrincipalRoleAssignments read. Nothing here decides who may appoint: the server does.
import { refusalText } from "../../services/adminControlPlaneClient.js";

export const ADMINISTRATOR_ROLE_KEY = "admin";
const GLOBAL = "global";

/** The designated Administrator Role from the server's Role list: key `admin` AND protected. Null when absent. */
export function designatedAdministratorRole(roles) {
  if (!Array.isArray(roles)) return null;
  return roles.find((r) => r && r.key === ADMINISTRATOR_ROLE_KEY && r.protected === true) ?? null;
}

/** The ACTIVE GLOBAL assignment of the Administrator Role among the server's rows, or null. */
export function activeGlobalAdministratorAssignment(rows, adminRole) {
  if (!Array.isArray(rows) || !adminRole) return null;
  return rows.find((a) => a && a.status === "active" && a.roleId === adminRole.id
    && (a.scopeType ?? GLOBAL) === GLOBAL && !a.scopeValue) ?? null;
}

// A short human sentence for the refusals this control expects; the server's own code and message are ALWAYS shown too.
const REFUSAL_SENTENCES = [
  [/SELF_ADMINISTRATION/, "No one may appoint or remove themself as Administrator; another Administrator or the Owner must do it."],
  [/PROTECTED_ROLE_CONFLICT/, "This person holds the Owner Role, and the Owner cannot also be appointed Administrator."],
  [/WOULD_REMOVE_LAST_ADMINISTRATION_PATH|last active administering assignment/i,
    "This is the last Administrator. Appoint another Administrator before removing this one."],
  [/PRIVILEGE_ESCALATION/, "Your account is not permitted to appoint or remove Administrators."],
  [/REASON_REQUIRED/, "A reason is required to change an Administrator appointment."],
];

/** The human sentence for a refusal, or null when the outcome was accepted. Falls back to the code's category. */
export function administratorRefusalSentence(result) {
  const text = refusalText(result);
  if (!text) return null;
  for (const [pattern, sentence] of REFUSAL_SENTENCES) if (pattern.test(text)) return sentence;
  if (result.code === "FORBIDDEN") return "Your account is not permitted to appoint or remove Administrators.";
  return "The server refused the change. Nothing was changed.";
}
