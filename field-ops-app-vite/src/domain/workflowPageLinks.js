// Page selection only. The existing Administration gate and server commands own access.
//
// These are FULL-PAGE links (an unsaved-changes guard relies on the browser's leave-page prompt), so they must carry
// the app's build-time base path themselves -- a bare "/administration/..." leaves an app served under a base
// (e.g. /Taylor_Parts/field-ops/) and lands on a blank page. W01 acceptance, 2026-10-09.
function appBase() {
  let base = "/";
  try { base = import.meta.env?.BASE_URL ?? "/"; } catch { base = "/"; }
  return String(base).replace(/\/+$/, "");
}

/** An in-app path ("/administration/...") as a full-page href under the app's base path. */
export function appHref(path) {
  return `${appBase()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function workflowAssignmentsHref(workflow) {
  return appHref(`/administration/workflows${workflow?.key ? `?${new URLSearchParams({ workflow: workflow.key })}` : ""}`);
}

export function workflowBuilderHref(workflow, versionId) {
  const params = new URLSearchParams({ view: "builder" });
  if (workflow?.key) params.set("workflow", workflow.key);
  if (versionId) params.set("version", versionId);
  return appHref(`/administration/workflows?${params}`);
}

/** Keep the chosen workflow in the address (reload / bookmark / share keep it). replaceState adds no history entry. */
export function rememberSelectedWorkflow(workflow) {
  try {
    const url = new URL(globalThis.location.href);
    if (workflow?.key) url.searchParams.set("workflow", workflow.key); else url.searchParams.delete("workflow");
    url.searchParams.delete("version");
    globalThis.history.replaceState(globalThis.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch { /* no address bar (tests, embeds) */ }
}
