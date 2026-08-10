// C-7 Context Registry — the governed context MAP (slice 1).
//
// AI-reviewed design (study §12, ChatGPT CONCUR_WITH_CORRECTION). The map is NAVIGATION +
// governed retrieval policy, NOT storage and NOT a retrieval engine. It holds POINTERS +
// governance metadata; it stores no substantive knowledge and duplicates no existing EOS
// authority (C2). Retrieval stays grep + explicit file paths; there is NO vector DB, NO
// embeddings, NO server, NO second authority.
//
// This module provides the pure contracts: entry schema + validation, the Context Health lint,
// deterministic PRECEDENCE resolution ("which artifact GOVERNS this assignment?" — C1), and a
// REPRODUCIBLE context-package generator (C7) that enforces negative retrieval (C6) and the
// retrieve-don't-guess sufficiency escalation (C8). No I/O; the driver loads the map + front-matter.

export const CONTEXT_KINDS = Object.freeze(["evidence", "finding", "decision", "principle", "model", "distilled"]);
export const LIFECYCLE_STATES = Object.freeze(["current", "superseded", "historical"]);
export const APPLICABILITY_SCOPES = Object.freeze(["company", "platform", "deployment", "capability", "workflow", "environment"]);
export const CONTEXT_LEVELS = Object.freeze(["L0", "L1", "L2", "L3"]); // bootstrap / required / on-demand / historical

// C1 precedence — deterministic "which governs". Higher rank wins. principle > accepted-decision >
// model > distilled > finding > evidence; a `current` lifecycle always beats non-current; and a
// Taylor-specific rule beats a platform default at equal rank (applicability specificity).
const KIND_RANK = Object.freeze({ principle: 5, decision: 4, model: 3, distilled: 2, finding: 1, evidence: 0 });

const DEFAULTS = Object.freeze({
  kind: "evidence", scope: [], applicability: {}, lifecycle: "current", supersededBy: null,
  relationships: [], freshnessRef: null, provenance: null, level: "L2",
});

export function createContextEntry(input = {}) {
  const e = { ...DEFAULTS, ...input };
  e.scope = [...(e.scope || [])];
  e.relationships = [...(e.relationships || [])];
  return Object.freeze(e);
}

export function validateContextEntry(e) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  need(!!e.id, "id is required");
  need(!!e.purpose, "purpose is required (why this exists)");
  need(!!e.retrievalPath, "retrievalPath is required (how an agent retrieves it) — an entry with none is an orphan");
  need(CONTEXT_KINDS.includes(e.kind), `kind must be one of ${CONTEXT_KINDS.join("/")}`);
  need(LIFECYCLE_STATES.includes(e.lifecycle), `lifecycle must be one of ${LIFECYCLE_STATES.join("/")}`);
  need(CONTEXT_LEVELS.includes(e.level), `level must be one of ${CONTEXT_LEVELS.join("/")}`);
  // authority may be null ONLY for raw evidence; distilled/decision/principle/model must name an authority.
  if (e.kind !== "evidence") need(!!e.authority, `${e.id}: a ${e.kind} must name its authority`);
  if (e.lifecycle === "superseded") need(!!e.supersededBy, `${e.id}: a superseded entry must name supersededBy`);
  return errors;
}

const scopeOverlap = (a = [], b = []) => a.some((s) => b.includes(s));

// C5 (structural half) + C2: Context Health lint. Returns durable defects, never a vanity score.
export function lintContextMap(entries = []) {
  const defects = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) {
    for (const err of validateContextEntry(e)) defects.push({ type: "INVALID_ENTRY", entryId: e.id || "?", detail: err });
    if (!e.retrievalPath) defects.push({ type: "NO_RETRIEVAL_PATH", entryId: e.id, detail: "orphan — not retrievable" });
    if (e.lifecycle === "superseded" && e.supersededBy && !byId.has(e.supersededBy)) {
      defects.push({ type: "DANGLING_SUPERSEDE", entryId: e.id, detail: `supersededBy ${e.supersededBy} not in map` });
    }
  }
  // conflicting authority: two CURRENT entries claiming the same authority over overlapping scope.
  const current = entries.filter((e) => e.lifecycle === "current" && e.authority);
  for (let i = 0; i < current.length; i++) {
    for (let j = i + 1; j < current.length; j++) {
      if (current[i].authority === current[j].authority && scopeOverlap(current[i].scope, current[j].scope) && current[i].kind === current[j].kind) {
        defects.push({ type: "CONFLICTING_AUTHORITY", entryId: current[i].id, detail: `${current[i].id} & ${current[j].id} both current for authority '${current[i].authority}' over overlapping scope` });
      }
    }
  }
  return { defects, healthy: defects.length === 0 };
}

// C1: resolve which entry GOVERNS an assignment scope. Only CURRENT + applicable entries compete;
// superseded/historical never govern. Deterministic order → the governing entry + the ranked list.
export function resolvePrecedence(entries = [], { scope = [] } = {}) {
  const applicable = entries.filter((e) => e.lifecycle === "current" && scopeOverlap(e.scope, scope));
  const ranked = [...applicable].sort((a, b) => {
    if (KIND_RANK[b.kind] !== KIND_RANK[a.kind]) return KIND_RANK[b.kind] - KIND_RANK[a.kind];
    // tie-break: more specific applicability (a deployment/capability rule) beats a platform default.
    const spec = (e) => (e.applicability && e.applicability.deployment ? 2 : e.applicability && e.applicability.capability ? 1 : 0);
    return spec(b) - spec(a);
  });
  return { governing: ranked[0] || null, ranked };
}

// C6 + C7 + C8: build a REPRODUCIBLE context package for an assignment. Selects L1 (required, in
// scope) + lists L2 (on-demand) via the map; EXCLUDES superseded/historical/out-of-scope (negative
// retrieval); records map/source provenance (reproducible); and escalates to EVIDENCE_REQUIRED when
// no L1 authority covers the scope (retrieve-don't-guess — a broad file is not sufficient context).
export function buildContextPackage({ assignment, entries = [], mapVersion = null, sourceCommit = null } = {}) {
  const scope = (assignment && assignment.scope) || [];
  const inScopeCurrent = entries.filter((e) => e.lifecycle === "current" && scopeOverlap(e.scope, scope));
  const l1 = inScopeCurrent.filter((e) => e.level === "L1" || e.level === "L0");
  const l2 = inScopeCurrent.filter((e) => e.level === "L2");
  const { governing } = resolvePrecedence(entries, { scope });
  const excluded = entries
    .filter((e) => e.lifecycle !== "current" || !scopeOverlap(e.scope, scope))
    .map((e) => ({ id: e.id, reason: e.lifecycle !== "current" ? e.lifecycle : "out-of-scope" }));

  const sufficiency = l1.length > 0 ? "SUFFICIENT" : "EVIDENCE_REQUIRED";
  return Object.freeze({
    assignmentId: assignment && assignment.id,
    provenance: { mapVersion, sourceCommit }, // reproducible: what the worker knew (C7)
    governingAuthority: governing ? governing.id : null,
    required: l1.map((e) => ({ id: e.id, retrievalPath: e.retrievalPath, authority: e.authority, freshnessRef: e.freshnessRef })), // L1 refs, not copies
    onDemand: l2.map((e) => ({ id: e.id, retrievalPath: e.retrievalPath })),                                                     // L2 refs
    excluded,                 // negative retrieval, made explicit (C6)
    sufficiency,              // EVIDENCE_REQUIRED → retrieve-don't-guess escalation (C8)
    selectionReason: `scope [${scope.join(",")}] → ${l1.length} required, ${l2.length} on-demand; ${excluded.length} excluded (superseded/historical/out-of-scope)`,
  });
}
