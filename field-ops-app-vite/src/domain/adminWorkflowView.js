// Administration → Workflows — the PURE view model, over what the SERVER returned.
//
// ════════════════════ NO CLIENT COPY OF ANY DEFINITION ════════════════════
//
// This file used to carry a second, client-side copy of the five seeded workflow families and render
// it as if it were the tenant's configuration. It no longer does: every workflow, version, step,
// action, binding, guard and validation finding shown in Administration comes from the EOS API
// (listWorkflows, readWorkflowVersion, validateWorkflowVersion, ...), and the seeds live only in
// functions/src/adminPolicy/workflowSeeds.ts, which the server applies.
//
// ════════════════════ WHAT THIS COMPUTES ════════════════════
//
// Presentation only: which actions leave a state, how a version's lifecycle reads, which lifecycle
// buttons are worth OFFERING, and the editable shape of a draft. It decides no authorization and
// evaluates no transition. Offering a button is not permission -- the server re-checks the
// capability and the lifecycle on every request, and its refusal is shown verbatim.

/** The closed guard list the server accepts (workflow_actions.guard_kind). Offered, never authored. */
export const WORKFLOW_GUARD_OPTIONS = Object.freeze([
  Object.freeze({ value: "", label: "No guard" }),
  Object.freeze({ value: "RECORD_ASSIGNMENT", label: "Record assignment (the assigned Employee only)" }),
]);

/** One entry of listWorkflows, summarised for the list. Unknown shapes yield null, never a guess. */
export function summarizeWorkflow(entry) {
  const workflow = entry?.workflow;
  if (!workflow || typeof workflow.id !== "string") return null;
  const versions = Array.isArray(entry.versions) ? [...entry.versions].sort((a, b) => a.version - b.version) : [];
  const active = versions.find((v) => v.id === workflow.activeVersionId) ?? null;
  return Object.freeze({
    id: workflow.id,
    key: workflow.key,
    name: workflow.name ?? workflow.key,
    description: workflow.description ?? null,
    objectKey: workflow.objectKey ?? null,
    activeVersionId: workflow.activeVersionId ?? null,
    activeVersion: active ? active.version : null,
    versions: Object.freeze(versions.map((v) => Object.freeze({
      id: v.id,
      version: v.version,
      status: v.status,
      active: v.id === workflow.activeVersionId,
      publishedAt: v.publishedAt ?? null,
    }))),
    counts: Object.freeze({
      draft: versions.filter((v) => v.status === "DRAFT").length,
      published: versions.filter((v) => v.status === "PUBLISHED").length,
      retired: versions.filter((v) => v.status === "RETIRED").length,
    }),
  });
}

/** How a version's lifecycle reads, in words the screen shows. */
export function lifecycleLabel(version) {
  if (!version) return "Unknown";
  if (version.status === "PUBLISHED") return version.active ? "Published · ACTIVE" : "Published · not active";
  if (version.status === "DRAFT") return "Draft";
  if (version.status === "RETIRED") return "Retired";
  return String(version.status);
}

/**
 * The lifecycle actions worth OFFERING for one version. The server decides; this only avoids drawing
 * a button whose answer is certainly a lifecycle refusal.
 */
export function lifecycleActions(version) {
  if (!version) return Object.freeze([]);
  const out = [];
  if (version.status === "DRAFT") out.push("publish", "retire");
  if (version.status === "PUBLISHED" && !version.active) out.push("activate", "retire");
  // Every version -- retired ones included -- can be the starting point of a new DRAFT.
  out.push("newVersion");
  return Object.freeze(out);
}

/** readWorkflowVersion's payload, with each state told which actions leave it. */
export function buildWorkflowVersionView(view) {
  if (!view || !Array.isArray(view.steps) || !Array.isArray(view.actions)) return null;
  const actions = view.actions.map((a) => Object.freeze({
    key: a.key,
    label: a.label,
    from: a.from,
    to: a.to,
    capabilityKey: a.capabilityKey ?? null,
    guardKind: a.guardKind ?? (a.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
    roleKeys: Object.freeze([...(a.roleKeys ?? [])]),
    bindings: Object.freeze((a.bindings ?? (a.roleKeys ?? []).map((roleKey) => ({ roleKey, bindingKind: "SECURITY_ROLE" })))
      .map((b) => Object.freeze({ roleKey: b.roleKey, bindingKind: b.bindingKind ?? "SECURITY_ROLE" }))),
  }));
  return Object.freeze({
    workflow: view.workflow ?? null,
    version: view.version ?? null,
    active: view.active === true,
    steps: Object.freeze(view.steps.map((s) => Object.freeze({
      key: s.key,
      label: s.label,
      initial: s.initial === true,
      terminal: s.terminal === true,
      outgoing: Object.freeze(actions.filter((a) => a.from === s.key).map((a) => a.label)),
    }))),
    actions: Object.freeze(actions),
    bindingCount: actions.reduce((n, a) => n + a.bindings.length, 0),
  });
}

// ════════════════════ the draft editor's shape ════════════════════

/** A version view -> the editable definition updateWorkflowDefinition / createWorkflowVersion accept. */
export function editableDefinition(view) {
  const v = view && Array.isArray(view.steps) ? view : { steps: [], actions: [] };
  return {
    steps: v.steps.map((s) => ({ key: s.key, label: s.label, initial: s.initial === true, terminal: s.terminal === true })),
    actions: (v.actions ?? []).map((a) => ({
      key: a.key,
      label: a.label,
      from: a.from,
      to: a.to,
      capabilityKey: a.capabilityKey ?? "",
      guardKind: a.guardKind ?? "",
      roleKeys: (a.roleKeys ?? []).join(", "),
    })),
  };
}

const splitKeys = (text) => String(text ?? "").split(/[\s,]+/).map((k) => k.trim()).filter(Boolean);

/**
 * The editable form -> the definition the server receives. Blank capability and guard become null;
 * nothing is validated here -- validateWorkflowVersion and publish are the server's.
 */
export function definitionForServer(editable) {
  return {
    steps: (editable?.steps ?? []).map((s) => ({
      key: String(s.key ?? "").trim(),
      label: String(s.label ?? "").trim(),
      initial: s.initial === true,
      terminal: s.terminal === true,
    })),
    actions: (editable?.actions ?? []).map((a) => {
      const guardKind = String(a.guardKind ?? "").trim();
      const capabilityKey = String(a.capabilityKey ?? "").trim();
      return {
        key: String(a.key ?? "").trim(),
        label: String(a.label ?? "").trim(),
        from: String(a.from ?? "").trim(),
        to: String(a.to ?? "").trim(),
        capabilityKey: capabilityKey.length > 0 ? capabilityKey : null,
        guardKind: guardKind.length > 0 ? guardKind : null,
        requiresOwnAssignment: guardKind === "RECORD_ASSIGNMENT",
        roleKeys: splitKeys(a.roleKeys),
      };
    }),
  };
}

export const blankStep = () => ({ key: "", label: "", initial: false, terminal: false });
export const blankAction = () => ({ key: "", label: "", from: "", to: "", capabilityKey: "", guardKind: "", roleKeys: "" });

/** validateWorkflowVersion's result, grouped for display. Unknown shapes yield null. */
export function validationSummary(result) {
  if (!result || !Array.isArray(result.errors) || !Array.isArray(result.warnings)) return null;
  const byCode = (items) => {
    const groups = new Map();
    for (const i of items) groups.set(i.code, [...(groups.get(i.code) ?? []), i]);
    return [...groups.entries()].map(([code, list]) => Object.freeze({ code, items: Object.freeze(list) }));
  };
  return Object.freeze({
    valid: result.valid === true && result.errors.length === 0,
    errors: Object.freeze(byCode(result.errors)),
    warnings: Object.freeze(byCode(result.warnings)),
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
  });
}

// ════════════════════ BUSINESS AREAS vs STATE MACHINES ════════════════════
//
// Owner terminology (2026-09-08). Administration presents three business workflow AREAS over the
// versioned state machines the server holds. An area is a presentation grouping keyed by the
// machine's workflow key: it has no state, no transition and no binding, and nothing resolves
// authority against it. A workflow no area names is shown under "Other" rather than hidden.

export const WORKFLOW_AREAS = Object.freeze([
  Object.freeze({
    key: "partsPurchasing",
    name: "Parts / Purchasing",
    description: "Raising, approving, assigning, purchasing and receiving a reorder request.",
    machineKeys: Object.freeze(["partsPurchasing"]),
  }),
  Object.freeze({
    key: "workOrder",
    name: "Technician / Work Order",
    description: "Scheduling, dispatching and executing field work through to close.",
    machineKeys: Object.freeze(["workOrder"]),
  }),
  Object.freeze({
    key: "sales",
    name: "Sales",
    description:
      "Three linked state machines: an Opportunity is won, which creates an Agreement, whose acceptance creates an Order. Chained by events, not by transitions.",
    machineKeys: Object.freeze(["salesOpportunity", "salesAgreement", "salesOrder"]),
  }),
]);

/** Which area a workflow key belongs to, or null. */
export function areaForMachine(machineKey) {
  return WORKFLOW_AREAS.find((a) => a.machineKeys.includes(machineKey)) ?? null;
}

/** Summaries grouped by area, in area order, with an "Other" group for anything unnamed. */
export function groupWorkflowsByArea(summaries) {
  const list = (summaries ?? []).filter(Boolean);
  const groups = WORKFLOW_AREAS.map((area) => ({
    key: area.key,
    name: area.name,
    description: area.description,
    workflows: area.machineKeys.map((k) => list.find((w) => w.key === k)).filter(Boolean),
  })).filter((g) => g.workflows.length > 0);
  const named = new Set(WORKFLOW_AREAS.flatMap((a) => a.machineKeys));
  const other = list.filter((w) => !named.has(w.key));
  if (other.length > 0) groups.push({ key: "other", name: "Other", description: "Workflows no business area names.", workflows: other });
  return groups;
}
