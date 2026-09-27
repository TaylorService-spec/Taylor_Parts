// Shared fixtures for the workflow control plane proofs (in-memory repository).
//
// A workflow mutation is authorized by a `workflowDefinition.*` CAPABILITY, never by the Role name
// `admin`, and a version publishes only when every bound Role holds the action's capability. These
// helpers build the smallest honest tenant for that: the catalog rows the migration chain
// registers, the grants an administrator would make through Administration after bootstrap, and
// the Objects a workflow governs.
import { SEED_WORKFLOWS } from "../../lib/adminPolicy/workflowSeeds.js";

export const WORKFLOW_DEFINITION_ACTIONS = Object.freeze(["create", "read", "edit", "version", "publish", "bindRole"]);
export const WORKFLOW_DEFINITION_CAPABILITIES = Object.freeze(WORKFLOW_DEFINITION_ACTIONS.map((a) => `workflowDefinition.${a}`));

const capabilityRow = (key) => {
  const parts = key.split(".");
  const objectKey = parts[0];
  const actionKey = parts.slice(1).join("_") || "act";
  return {
    key, description: key, objectKey, actionKey,
    actionKind: objectKey === "workflowDefinition" ? (actionKey === "read" ? "READ" : "ADMIN_ACTION") : "WORKFLOW_ACTION",
    displayLabel: key,
  };
};

/** Every capability the seeds name, plus the workflow-administration keys. Idempotent. */
export function registerWorkflowCatalog(repo, extraKeys = []) {
  const keys = new Set([
    ...WORKFLOW_DEFINITION_CAPABILITIES,
    ...SEED_WORKFLOWS.flatMap((w) => w.actions.map((a) => a.capabilityId).filter(Boolean)),
    ...extraKeys,
  ]);
  const rows = repo.registerCapabilities([...keys].map(capabilityRow));
  return Object.fromEntries(rows.map((c) => [c.key, c]));
}

/** Grant (roleId, capabilityKey) pairs as a migration or an Administration decision would. */
export async function grantCapabilities(repo, tenantId, pairs) {
  const catalog = Object.fromEntries((await repo.listCapabilities()).map((c) => [c.key, c]));
  const existing = await repo.listRoleCapabilities(tenantId);
  await repo.transact({ tenantId, uid: "fixture" }, async (tx) => {
    for (const { roleId, capabilityKey } of pairs) {
      const capability = catalog[capabilityKey];
      if (!capability) throw new Error(`fixture: capability ${capabilityKey} is not registered`);
      if (existing.some((g) => g.roleId === roleId && g.capabilityId === capability.id)) continue;
      await tx.grantRoleCapability({ roleId, capabilityId: capability.id, grantedBy: "fixture", grantedAt: new Date().toISOString() });
    }
  });
}

/** The post-bootstrap Administration act: this Role may administer workflows. */
export async function grantWorkflowAdministration(repo, tenantId, roleId, actions = WORKFLOW_DEFINITION_ACTIONS) {
  registerWorkflowCatalog(repo);
  await grantCapabilities(repo, tenantId, actions.map((a) => ({ roleId, capabilityKey: `workflowDefinition.${a}` })));
}

/** The Objects a workflow may govern. */
export async function createObjects(repo, tenantId, keys) {
  const have = new Set((await repo.listObjects(tenantId)).map((o) => o.key));
  await repo.transact({ tenantId, uid: "fixture" }, async (tx) => {
    for (const key of keys) {
      if (have.has(key)) continue;
      await tx.createObject({
        key, label: key, labelPlural: null, description: null, origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
      });
    }
  });
}

/**
 * Make a seed PUBLISHABLE: its Object exists and every bound Role holds the action's capability.
 * `skip` names "roleKey/capabilityKey" pairs to leave ungranted (a stale binding on purpose).
 */
export async function grantSeedBindings(repo, tenantId, rolesByKey, seed, skip = []) {
  registerWorkflowCatalog(repo);
  if (seed.objectKey) await createObjects(repo, tenantId, [seed.objectKey]);
  const pairs = [];
  for (const a of seed.actions) {
    if (!a.capabilityId) continue;
    for (const roleKey of a.roleKeys) {
      if (!rolesByKey[roleKey] || skip.includes(`${roleKey}/${a.capabilityId}`)) continue;
      pairs.push({ roleId: rolesByKey[roleKey].id, capabilityKey: a.capabilityId });
    }
  }
  await grantCapabilities(repo, tenantId, pairs);
}
