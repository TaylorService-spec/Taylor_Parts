// READING OBJECT-OWNED SECURITY, from a screen.
//
// Three projections of ONE server authority, plus the Object/action inventory the first two are
// read against:
//
//   Object    -> actions -> who holds each        useObjectSecurityMatrix
//   Role      -> objects -> actions               useRoleSecurity
//   Principal -> roles + direct grants -> access  usePrincipalEffectiveAccess
//
// ════════════════════ THESE ARE NOT AN AUTHORITY, AND NOTHING RENDERS THEM YET ════════════════════
//
// They are READS. They decide nothing, they are not Permission Preview's replacement, and no
// Administration screen or navigation entry calls them in this tranche. They exist so that the
// screen which eventually does has one place to ask from -- the same reason the Workforce reads
// were named ahead of their UI.
//
// The answers come from PostgreSQL through the EOS trusted API. A client-only check is never
// sufficient for access, so what these return is for DISPLAY: showing an administrator what the
// server would answer, not deciding it here.
//
// ════════════════════ A MISSING KEY IS NOT A REQUEST ════════════════════
//
// `useObjectSecurityMatrix(null)` asks nothing rather than sending an empty input and rendering the
// INVALID_INPUT that comes back. That is not the client validating: it is a screen with no Object
// selected yet, which is a state, not an error. The moment a key is present the request goes out
// and the SERVER decides whether it is a good one.
import { useMemo } from "react";
import { usePolicyStore } from "./usePolicyStore.js";
import {
  buildObjectSecurityReadModel,
  buildPrincipalAccessReadModel,
  buildRoleSecurityReadModel,
} from "./objectSecurityReadModel.js";

/** Every Object this tenant registered, with the actions it governs. Takes no input. */
export function useObjectsWithActions(options = {}) {
  return usePolicyStore("listObjectsWithActions", null, options);
}

/** One Object: every action it governs and who holds each -- Roles AND Principals. */
export function useObjectSecurityMatrix(objectKey, options = {}) {
  return usePolicyStore(
    "getObjectSecurityMatrix",
    objectKey ? { objectKey } : null,
    { ...options, enabled: options.enabled !== false && Boolean(objectKey) },
  );
}

/** One Security Role: the Objects it reaches and the actions it may perform on each. */
export function useRoleSecurity(roleKey, options = {}) {
  return usePolicyStore(
    "getRoleSecurity",
    roleKey ? { roleKey } : null,
    { ...options, enabled: options.enabled !== false && Boolean(roleKey) },
  );
}

/**
 * One Principal: active Roles, direct grants, and the effective capabilities with their provenance.
 *
 * A PRINCIPAL, not an Employee. Work Eligibility, Operational Scope and the linked Employee are not
 * in this answer and must not be joined onto it here -- they are subordinate constraints on a
 * capability already held, and a business fact shown beside a grant reads as a grant.
 */
export function usePrincipalEffectiveAccess(principalId, options = {}) {
  return usePolicyStore(
    "getPrincipalEffectiveAccess",
    principalId ? { principalId } : null,
    { ...options, enabled: options.enabled !== false && Boolean(principalId) },
  );
}

// ════════════════════ THE SAME READS, ASSEMBLED ════════════════════
//
// The four hooks above hand back the server's payload untouched, which is right and is not enough
// to draw with: two of the three projections send action KEYS and no labels (see
// objectSecurityReadModel.js). These three compose the read WITH the Object/action inventory and
// return the canonical read model, so the screen that eventually renders Object security performs
// an assembly rather than a design.
//
// THEY ADD NO AUTHORITY. Same operations, same server, same refusals. The composition is a join and
// a count; nothing here decides whether anybody may do anything, and no Administration screen calls
// them in this tranche.
//
// A MISSING KEY STILL MEANS NO REQUEST -- including the inventory read. A Role security panel with
// no Role chosen must not fetch the tenant's whole Object catalog on the chance that one is chosen.

/** failed beats unconfigured beats loading. A partial answer is never rendered as a whole one. */
function combineStatus(reads) {
  if (reads.some((r) => r.status === "failed")) return "failed";
  if (reads.some((r) => r.status === "unconfigured")) return "unconfigured";
  if (reads.some((r) => r.status === "loading")) return "loading";
  return "ready";
}

/**
 * Turn N reads plus an already-built model into one read-model result.
 *
 * A model that is null while every read is READY is a FAILURE, not an empty model: it means the
 * payload was not the shape the server's contract promises, and drawing an empty security grid for
 * it would tell an administrator that nobody holds anything.
 */
function assemble(reads, model) {
  const status = combineStatus(reads);
  const failure = reads.find((r) => r.status === "failed") ?? null;
  const unreadable = status === "ready" && model === null;
  return {
    status: unreadable ? "failed" : status,
    model: status === "ready" ? model : null,
    error: failure
      ? failure.error
      : unreadable
        ? Object.freeze({
          ok: false,
          code: "UNREADABLE_PAYLOAD",
          message: "the Administration API returned a security payload this screen cannot read",
          description: "The security read could not be understood, so nothing is shown.",
        })
        : null,
    tenantId: reads.find((r) => r.tenantId)?.tenantId ?? null,
    reload: () => reads.forEach((r) => r.reload()),
    configured: reads.every((r) => r.configured),
  };
}

/**
 * OBJECT VIEW, assembled. One Object -> its actions -> the Roles and the Principals holding each.
 *
 * ONE read: `getObjectSecurityMatrix` already carries `displayLabel` and `capabilityKey` on every
 * row, so no inventory join is needed here. What the model adds is the reading an administrator
 * arrives for -- which actions NOBODY holds, and the union of everyone who reaches this Object.
 */
export function useObjectSecurityReadModel(objectKey, options = {}) {
  const matrix = useObjectSecurityMatrix(objectKey, options);
  const model = useMemo(
    () => (matrix.status === "ready" ? buildObjectSecurityReadModel(matrix.data) : null),
    [matrix.status, matrix.data],
  );
  return assemble([matrix], model);
}

/**
 * ROLE VIEW, assembled. One Security Role -> Objects -> the actions it may perform on each.
 *
 * TWO reads, because the Role projection sends grant facts with no vocabulary: `getRoleSecurity`
 * for what is held, `listObjectsWithActions` for what those keys are CALLED. The inventory read is
 * gated on the Role key for the same reason the Role read is.
 */
export function useRoleSecurityReadModel(roleKey, options = {}) {
  const enabled = options.enabled !== false && Boolean(roleKey);
  const role = useRoleSecurity(roleKey, options);
  const inventory = useObjectsWithActions({ ...options, enabled });
  const model = useMemo(
    () => (role.status === "ready" && inventory.status === "ready"
      ? buildRoleSecurityReadModel(role.data, inventory.data)
      : null),
    [role.status, role.data, inventory.status, inventory.data],
  );
  return assemble([role, inventory], model);
}

/**
 * PRINCIPAL VIEW, assembled. One Principal -> Roles and direct grants -> effective access.
 *
 * TWO reads, for the Object labels. `effective` already carries each capability's own label, kind,
 * key and PROVENANCE, and none of that is recomputed: the model regroups the server's rows by
 * Object and reports whether that regrouping matches the grouping the server itself sent.
 */
export function usePrincipalAccessReadModel(principalId, options = {}) {
  const enabled = options.enabled !== false && Boolean(principalId);
  const access = usePrincipalEffectiveAccess(principalId, options);
  const inventory = useObjectsWithActions({ ...options, enabled });
  const model = useMemo(
    () => (access.status === "ready" && inventory.status === "ready"
      ? buildPrincipalAccessReadModel(access.data, inventory.data)
      : null),
    [access.status, access.data, inventory.status, inventory.data],
  );
  return assemble([access, inventory], model);
}
