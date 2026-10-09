// Page selection only. The existing Administration gate and server commands own access.
export function workflowBuilderHref(workflow, versionId) {
  const params = new URLSearchParams({ view: "builder" });
  if (workflow?.key) params.set("workflow", workflow.key);
  if (versionId) params.set("version", versionId);
  return `/administration/workflows?${params}`;
}
