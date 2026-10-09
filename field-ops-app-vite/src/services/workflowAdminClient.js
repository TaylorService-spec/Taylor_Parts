// ADMINISTRATION > WORKFLOWS, from the browser: one thin, named seam over `POST /admin/policy`.
//
//   Admin UI -> THIS -> callPolicyApi -> EOS trusted API -> governed PostgreSQL -> the workflow engine
//
// Each wrapper sends exactly the input the server's workflow dispatcher (workflowAdminApi.ts) reads
// and returns the server's envelope untouched: `{ ok: true, data }` or `{ ok: false, code, message }`.
// It holds no definition, validates nothing and decides nothing: validation codes, lifecycle
// refusals and missing-capability refusals are the SERVER's, and a screen shows them verbatim.
import { callPolicyApi } from "./adminPolicyApiClient.js";

/** Build the seam over any `call(operation, input)` with callPolicyApi's envelope -- injectable for tests. */
export function createWorkflowAdminClient(call = callPolicyApi) {
  const send = (operation, input) => Promise.resolve(call(operation, input ?? {}))
    .catch(() => ({ ok: false, code: "UNREACHABLE", message: "the Administration API could not be reached" }));
  return Object.freeze({
    // ── reads (gate: workflowDefinition.read; responsibilities: admin.principalAccess.read) ──
    listWorkflows: () => send("listWorkflows", {}),
    readMyWorkflowAdministration: () => send("readMyWorkflowAdministration", {}),
    readWorkflowVersion: (versionId) => send("readWorkflowVersion", { versionId }),
    validateWorkflowVersion: (versionId) => send("validateWorkflowVersion", { versionId }),
    validateUnsavedDefinition: ({ objectKey, definition }) => send("validateWorkflowVersion", { objectKey, definition }),
    listWorkflowInstances: (versionId) => send("listWorkflowInstances", { versionId }),
    readWorkflowHistory: (workflowId, limit = 100) => send("readWorkflowHistory", { workflowId, limit }),
    listPrincipalWorkflowResponsibilities: (principalId) => send("listPrincipalWorkflowResponsibilities", { principalId }),

    // ── mutations (gate: the workflowDefinition.* capability each maps to; reason required where noted) ──
    createWorkflowDraft: ({ key, name, description, objectKey, definition, reason }) =>
      send("createWorkflowDraft", { key, name, description, objectKey, definition, reason }),
    createWorkflowVersion: ({ workflowId, copyFromVersionId, definition, reason }) =>
      send("createWorkflowVersion", {
        workflowId, reason,
        ...(copyFromVersionId ? { copyFromVersionId } : {}),
        ...(definition ? { definition } : {}),
      }),
    updateWorkflowDefinition: ({ versionId, definition, reason }) => send("updateWorkflowDefinition", { versionId, definition, reason }),
    publishWorkflowVersion: ({ versionId, reason }) => send("publishWorkflowVersion", { versionId, reason }),
    activateWorkflowVersion: ({ versionId, reason }) => send("activateWorkflowVersion", { versionId, reason }),
    retireWorkflowVersion: ({ versionId, reason }) => send("retireWorkflowVersion", { versionId, reason }),
    // #210: a record enters the ACTIVE version (pinned at its initial step), and in-flight records move between versions with
    // an explicit step map -- both workflowDefinition.publish, each one audited instance event.
    startWorkflowInstance: ({ workflowKey, recordId, reason }) => send("startWorkflowInstance", { workflowKey, recordId, reason }),
    migrateWorkflowInstances: ({ fromVersionId, toVersionId, stepMap, reason }) => send("migrateWorkflowInstances", { fromVersionId, toVersionId, stepMap, reason }),
  });
}

/** The production seam. */
export const workflowAdminClient = createWorkflowAdminClient();
