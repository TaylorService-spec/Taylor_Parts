// The Administration policy BOOTSTRAP SEED.
//
// ════════════════════ WHAT IT SEEDS, AND FROM WHERE ════════════════════
//
//   Objects + Fields   policySeedSnapshot.json, GENERATED from the client metadata registry
//                      (29 entities / 394 declared fields) and the Object x CRED map. One
//                      authority, one generated artifact, one drift guard -- never a second
//                      hand-maintained field model.
//   Roles              COMPATIBILITY_ROLES + GOVERNED_BUSINESS_ROLES, imported directly because
//                      they already live in functions/.
//   Object CRED        DERIVED: a Role gets verb V on object O when it holds at least one of the
//                      capability ids the matrix maps to (O, V). Not hand-written, so it cannot
//                      disagree with the authorization the platform already performs.
//   Workflows          the three families in workflowSeeds.ts, measured from the running code.
//
// ════════════════════ THE SIX PROPERTIES ════════════════════
//
//   DETERMINISTIC  same inputs, same output. Nothing reads a clock to decide WHAT to write, and
//                  ordering is by key rather than by object iteration order.
//   TENANT-AWARE   every row carries the tenant it was seeded into. Seeding tenant B never touches
//                  tenant A.
//   IDEMPOTENT     a second run creates nothing and changes nothing. Existence is checked by
//                  NATURAL KEY, not by remembering what the last run did.
//   VERSIONED      SEED_VERSION is recorded in the audit trail, so "which seed produced this
//                  tenant" is answerable later.
//   AUDITABLE      one audit event per run, carrying the counts and the version.
//   SAFE TO RERUN  it never deletes, never overwrites a customer's edit, and never re-grants a
//                  permission an administrator has since removed. A seed that reset policy on every
//                  deploy would silently undo configuration -- the worst kind of "safe".
//
// ════════════════════ D-2: AN UNSUPPORTED CRED CELL IS REFUSED ════════════════════
//
// A verb no capability governs is NOT seeded, for any Role, ever. There is no enforcement point for
// it, so persisting it would be a grant the engine could never honour -- a fake permission an
// administrator would read as real. The snapshot carries `capabilitiesByVerb` precisely so this
// file can tell "not granted" from "cannot be granted".
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../../access/governedBusinessRoles";
import { PROTECTED_ROLE_KEYS } from "../administrationAuthority";
import { SEED_WORKFLOWS } from "../workflowSeeds";
import type { PolicyRepository } from "../policyRepository";
import type { CredSet, CredVerb, TenantId } from "../types";
import snapshot from "./policySeedSnapshot.json";

/** Bumped when the seed's OUTPUT changes, not when its inputs do. Recorded in the audit event. */
export const SEED_VERSION = 1;

/** The snapshot shape this file understands. A newer one is refused rather than half-read. */
const SUPPORTED_SNAPSHOT_VERSION = 1;

export interface SeedResult {
  readonly tenantId: TenantId;
  readonly seedVersion: number;
  readonly created: {
    readonly objects: number;
    readonly fields: number;
    readonly roles: number;
    readonly objectPermissions: number;
    readonly workflows: number;
    readonly workflowVersions: number;
    readonly workflowSteps: number;
    readonly workflowActions: number;
    readonly workflowRoleBindings: number;
  };
  /** True when the run found everything already present. A rerun should report this. */
  readonly alreadySeeded: boolean;
  /** Role keys a workflow binds that this seed did not create. Reported, never invented. */
  readonly missingRoleKeys: readonly string[];
}

interface SnapshotField {
  key: string; label: string; description: string | null; dataType: string; required: boolean;
  allowedValues: string[]; defaultValue: string | null; searchable: boolean; sortable: boolean;
  reportable: boolean; sensitivity: string; referenceTo: string | null;
}
interface SnapshotObject {
  key: string; label: string; labelPlural: string | null; description: string | null; domain: string;
  supportsDelete: boolean; capabilitiesByVerb: Record<CredVerb, string[]>; fields: SnapshotField[];
}

const VERBS: readonly CredVerb[] = ["C", "R", "E", "D"];

/** Every Role the platform declares, compatibility and governed alike, keyed by its id. */
function allRoles(): Record<string, { id: string; name: string; description: string; permissions: readonly string[] }> {
  return { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES } as never;
}

/**
 * The CRED a Role gets on one object, DERIVED from what it actually holds.
 *
 * A verb with NO governing capability is left false and is separately reported as ungoverned by
 * `ungovernedVerbs` -- the two are different facts and the caller must not conflate them.
 */
export function deriveObjectCred(
  held: ReadonlySet<string>,
  capabilitiesByVerb: Record<CredVerb, readonly string[]>,
  supportsDelete: boolean,
): CredSet {
  const cred: Record<CredVerb, boolean> = { C: false, R: false, E: false, D: false };
  for (const verb of VERBS) {
    const ids = capabilitiesByVerb[verb] ?? [];
    if (ids.length === 0) continue; // ungoverned: not grantable to anyone
    cred[verb] = ids.some((id) => held.has(id));
  }
  // An object that does not support deletion cannot carry D, whatever the matrix implies.
  if (!supportsDelete) cred.D = false;
  return Object.freeze(cred);
}

/** Does this Role get any grant at all on this object? An all-false row is not worth storing. */
const hasAnyGrant = (cred: CredSet) => VERBS.some((v) => cred[v]);

/**
 * Seed one tenant.
 *
 * The whole run is ONE transaction. A half-seeded tenant -- objects without their fields, Roles
 * without their permissions -- is worse than an unseeded one, because it looks configured.
 */
export async function seedTenantPolicy(
  repo: PolicyRepository,
  tenantId: TenantId,
  actorUid: string,
): Promise<SeedResult> {
  if ((snapshot as { snapshotVersion: number }).snapshotVersion !== SUPPORTED_SNAPSHOT_VERSION) {
    throw new Error(
      `policySeedSnapshot.json is version ${(snapshot as { snapshotVersion: number }).snapshotVersion}, ` +
      `and this seed understands ${SUPPORTED_SNAPSHOT_VERSION}`,
    );
  }

  const objects = [...((snapshot as unknown as { objects: SnapshotObject[] }).objects)]
    // ORDERED BY KEY, so the run is deterministic regardless of the snapshot's own ordering.
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const roleDefinitions = allRoles();
  const roleKeys = Object.keys(roleDefinitions).sort();

  const created = {
    objects: 0, fields: 0, roles: 0, objectPermissions: 0,
    workflows: 0, workflowVersions: 0, workflowSteps: 0, workflowActions: 0, workflowRoleBindings: 0,
  };

  // EXISTENCE BY NATURAL KEY, read before the transaction so the idempotence check does not depend
  // on anything the run itself writes.
  const existingObjects = new Map((await repo.listObjects(tenantId)).map((o) => [o.key, o]));
  const existingRoles = new Map((await repo.listRoles(tenantId)).map((r) => [r.key, r]));
  const existingWorkflows = new Map((await repo.listWorkflows(tenantId)).map((w) => [w.key, w]));

  const missingRoleKeys = new Set<string>();

  await repo.transact({ tenantId, uid: actorUid }, async (tx) => {
    // ── objects and their fields ──
    const objectIdByKey = new Map<string, string>();
    for (const object of objects) {
      let id = existingObjects.get(object.key)?.id ?? null;
      if (id === null) {
        const row = await tx.createObject({
          key: object.key,
          label: object.label,
          labelPlural: object.labelPlural,
          description: object.description,
          origin: "SYSTEM",
          lifecycle: "ACTIVE",
          supportsDelete: object.supportsDelete,
        });
        id = row.id;
        created.objects += 1;
      }
      objectIdByKey.set(object.key, id);

      const existingFields = new Set((await repo.listFields(tenantId, id)).map((f) => f.key));
      for (const field of [...object.fields].sort((a, b) => (a.key < b.key ? -1 : 1))) {
        if (existingFields.has(field.key)) continue;
        await tx.createField({
          objectId: id,
          key: field.key,
          label: field.label,
          description: field.description,
          dataType: field.dataType as never,
          required: field.required,
          allowedValues: field.allowedValues,
          defaultValue: field.defaultValue,
          searchable: field.searchable,
          sortable: field.sortable,
          reportable: field.reportable,
          sensitivity: field.sensitivity as never,
          referenceTo: field.referenceTo,
          // SYSTEM: shipped with the platform, definition protected. An administrator configures
          // its permissions and cannot re-key or retype it.
          origin: "SYSTEM",
          lifecycle: "ACTIVE",
        });
        created.fields += 1;
      }
    }

    // ── roles ──
    const roleIdByKey = new Map<string, string>();
    for (const key of roleKeys) {
      const definition = roleDefinitions[key];
      let id = existingRoles.get(key)?.id ?? null;
      if (id === null) {
        const row = await tx.createRole({
          key,
          name: definition.name ?? key,
          description: definition.description ?? null,
          origin: "SYSTEM",
          // PROTECTED: cannot be deleted or stripped of administering authority, so ordinary
          // configuration cannot leave the tenant unadministrable.
          protected: PROTECTED_ROLE_KEYS.includes(key),
        });
        id = row.id;
        created.roles += 1;
      }
      roleIdByKey.set(key, id);
    }

    // ── baseline Object CRED, derived ──
    //
    // ONLY FOR ROLES AND OBJECTS THIS RUN CREATED. Re-deriving an existing tenant's permissions
    // would overwrite whatever an administrator has since configured, which is exactly the "safe"
    // seed that silently undoes a customer's work.
    for (const key of roleKeys) {
      if (existingRoles.has(key)) continue;
      const roleId = roleIdByKey.get(key) as string;
      const held = new Set(roleDefinitions[key].permissions ?? []);
      for (const object of objects) {
        const cred = deriveObjectCred(held, object.capabilitiesByVerb, object.supportsDelete);
        if (!hasAnyGrant(cred)) continue;
        await tx.setObjectPermission(roleId, objectIdByKey.get(object.key) as string, cred);
        created.objectPermissions += 1;
      }
    }

    // ── workflows ──
    for (const workflow of SEED_WORKFLOWS) {
      if (existingWorkflows.has(workflow.key)) continue;
      const wf = await tx.createWorkflow({
        key: workflow.key,
        name: workflow.name,
        description: workflow.description,
        objectKey: workflow.objectKey,
        origin: "SYSTEM",
      });
      created.workflows += 1;

      const version = await tx.createWorkflowVersion({
        workflowId: wf.id,
        version: 1,
        // DRAFT. Seeding a definition does not route any record through it -- proving the
        // definition matches measured behaviour comes first, and publication is a later decision.
        status: "DRAFT",
        publishedAt: null,
        publishedBy: null,
      });
      created.workflowVersions += 1;

      for (const step of workflow.steps) {
        await tx.createWorkflowStep({
          workflowVersionId: version.id, key: step.key, label: step.label,
          initial: step.initial === true, terminal: step.terminal === true,
        });
        created.workflowSteps += 1;
      }
      for (const action of workflow.actions) {
        await tx.createWorkflowAction({
          workflowVersionId: version.id, key: action.key, label: action.label,
          fromStepKey: action.from, toStepKey: action.to,
          requiresOwnAssignment: action.requiresOwnAssignment === true,
        });
        created.workflowActions += 1;
        for (const roleKey of action.roleKeys) {
          const roleId = roleIdByKey.get(roleKey);
          if (!roleId) { missingRoleKeys.add(roleKey); continue; }
          await tx.createWorkflowRoleBinding({
            workflowVersionId: version.id, actionKey: action.key, roleId,
          });
          created.workflowRoleBindings += 1;
        }
      }
    }

    const nothingCreated = Object.values(created).every((n) => n === 0);
    await tx.appendAudit({
      action: "seedTenantPolicy",
      actorUid,
      targetKind: "tenant",
      targetId: tenantId,
      occurredAt: new Date().toISOString(),
      reason: `seed v${SEED_VERSION}, snapshot v${SUPPORTED_SNAPSHOT_VERSION}`,
      before: null,
      // WHAT THIS RUN ACTUALLY DID, including a run that did nothing. "Already seeded" is a fact
      // worth having in the trail -- it is the evidence that a rerun was safe.
      after: { seedVersion: SEED_VERSION, created, alreadySeeded: nothingCreated },
    });
  });

  return {
    tenantId,
    seedVersion: SEED_VERSION,
    created,
    alreadySeeded: Object.values(created).every((n) => n === 0),
    missingRoleKeys: [...missingRoleKeys].sort(),
  };
}

/** The snapshot's own counts, for a caller that wants to report what it is about to seed. */
export const seedSnapshotCounts = () => (snapshot as unknown as { counts: Record<string, number> }).counts;
