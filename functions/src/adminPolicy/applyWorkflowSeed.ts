// Turning a measured workflow definition into stored policy.
//
// The seeds in workflowSeeds.ts are data describing existing behaviour. This is the one path that
// puts them into the store, and it goes through the same transaction, the same validation and the
// same audit as an administrator's own edit -- a seed is not a back door, it is the first draft.
//
// DRAFT UNLESS ASKED OTHERWISE. Applying a seed does not publish it, and publishing does not change
// how any record moves: routing execution through these definitions is a later, separately
// authorized step. The first job is to prove the definition is faithful.
import { PolicyValidationError } from "./policyCommands";
import { requireAdministrationAuthority } from "./administrationAuthority";
import { loadWorkflowVersionDefinition, validateWorkflowVersion } from "./workflowEngine";
import type { AdminActor } from "./policyCommands";
import type { PolicyRepository } from "./policyRepository";
import type { SeedWorkflow } from "./workflowSeeds";
import type { WorkflowVersionRecord } from "./types";

export interface AppliedSeed {
  readonly workflowId: string;
  readonly version: WorkflowVersionRecord;
  readonly stepCount: number;
  readonly actionCount: number;
  readonly bindingCount: number;
  /** Role keys the seed binds that do not exist in this tenant, so nothing is silently dropped. */
  readonly missingRoleKeys: readonly string[];
}

/**
 * Apply one seed as a new DRAFT version.
 *
 * A Role key the tenant does not have is REPORTED, not invented and not ignored. Creating the Role
 * would be a seed granting authority nobody asked for; ignoring it would publish a workflow whose
 * action silently has no performer. Naming it lets an administrator decide.
 */
export async function applyWorkflowSeed(
  repo: PolicyRepository,
  actor: AdminActor,
  seed: SeedWorkflow,
): Promise<AppliedSeed> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editWorkflowDefinition");

  const roles = await repo.listRoles(actor.tenantId);
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));
  const missingRoleKeys = [
    ...new Set(seed.actions.flatMap((a) => a.roleKeys).filter((k) => !roleIdByKey.has(k))),
  ];

  const existing = (await repo.listWorkflows(actor.tenantId)).find((w) => w.key === seed.key) ?? null;
  const priorVersions = existing ? await repo.listWorkflowVersions(actor.tenantId, existing.id) : [];
  const nextVersion = priorVersions.reduce((max, v) => Math.max(max, v.version), 0) + 1;

  const applied = await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const workflow = existing ?? (await tx.createWorkflow({
      key: seed.key,
      name: seed.name,
      description: seed.description,
      objectKey: seed.objectKey,
      origin: "SYSTEM",
    }));

    const version = await tx.createWorkflowVersion({
      workflowId: workflow.id,
      version: nextVersion,
      status: "DRAFT",
      publishedAt: null,
      publishedBy: null,
    });

    for (const s of seed.steps) {
      await tx.createWorkflowStep({
        workflowVersionId: version.id,
        key: s.key,
        label: s.label,
        initial: s.initial === true,
        terminal: s.terminal === true,
      });
    }

    let bindingCount = 0;
    for (const a of seed.actions) {
      await tx.createWorkflowAction({
        workflowVersionId: version.id,
        key: a.key,
        label: a.label,
        fromStepKey: a.from,
        toStepKey: a.to,
        requiresOwnAssignment: a.requiresOwnAssignment === true,
      });
      for (const key of a.roleKeys) {
        const roleId = roleIdByKey.get(key);
        if (!roleId) continue; // reported above, never invented
        await tx.createWorkflowRoleBinding({ workflowVersionId: version.id, actionKey: a.key, roleId });
        bindingCount += 1;
      }
    }

    await tx.appendAudit({
      action: "applyWorkflowSeed",
      actorUid: actor.uid,
      targetKind: "workflowVersion",
      targetId: version.id,
      occurredAt: new Date().toISOString(),
      reason: `seed "${seed.key}" v${nextVersion}`,
      before: null,
      after: { workflowKey: seed.key, version: nextVersion, missingRoleKeys },
    });

    return {
      workflowId: workflow.id,
      version,
      stepCount: seed.steps.length,
      actionCount: seed.actions.length,
      bindingCount,
      missingRoleKeys,
    };
  });

  // VALIDATED AFTER WRITING, and deliberately: the draft is worth keeping even when it is
  // incomplete -- an administrator can fix it -- but it must not be publishable while it is, and
  // publish re-runs exactly this check. A structural fault here is a fault in the SEED, so it is
  // raised loudly rather than left for someone to find at publication.
  const definition = await loadWorkflowVersionDefinition(repo, actor.tenantId, applied.version.id);
  const problems = validateWorkflowVersion(definition);
  if (problems.length > 0) {
    throw new PolicyValidationError(`seed "${seed.key}" is not a runnable definition: ${problems.join("; ")}`);
  }

  return applied;
}
