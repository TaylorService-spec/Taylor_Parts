#!/usr/bin/env node
// UAT census generator. READ-ONLY and OFFLINE: reads the controller's nonprod census JSON and this repository; writes only under --out and --repoDocs.
// Usage (from the repository root):
//   node docs/uat/tools/uatCensusGenerate.mjs --census D:/eos-lanes/evidence/uat-nonprod-census-2026-10-21.json --out D:/eos-lanes/evidence/uat --repoDocs docs/uat
// It opens no database, makes no network call, reads no credential and runs no test.
import fs from "node:fs";
import path from "node:path";
import { buildModel, toCsv } from "./uatModel.mjs";
import { buildRecordRows, buildSearchRows, buildDashboardRows, buildAnalysisRows, buildRouteRows, buildDecisionRows, RECORD_KINDS, RULINGS } from "./uatRecords.mjs";
import { PROBES } from "./uatProbes.mjs";
import { renderAll } from "./uatRender.mjs";
import { REPO_ROOT } from "./uatExtract.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const CENSUS = arg("census", "D:/eos-lanes/evidence/uat-nonprod-census-2026-10-21.json");
const OUT = arg("out", null);
const REPO_DOCS = path.resolve(REPO_ROOT, arg("repoDocs", "docs/uat"));
const PIN = arg("pin", "835e5982ba64b29020815e5dc749ea17568c1c1e");

const m = await buildModel(CENSUS);
if (m.probeProblems.length) { console.error("PROBE PROBLEMS", m.probeProblems); process.exit(2); }

// ------------------------------------------------------------------ assemble every expectation row (the manifest)
const tag = (r, extra) => ({ ...r, ...extra });
const pe = new Map(m.personas.map((p) => [p.key, p]));
const rows = [];
for (const r of m.personaCapRows) {
  const p = pe.get(r.persona);
  rows.push({ id: `${r.persona}:capability:${r.capability}`, persona: r.persona, tier: "capability", roles: (p.capSource.get(r.capability) ?? []).join("+") || (p.scopedCaps.get(r.capability) ?? []).map((s) => s.role).join("+"),
    company: "reach-dependent", object: r.object, action: r.action, kind: r.kind, capability: r.capability, expected: r.expected, basis: r.basis,
    source: r.basis.includes("STANDING") ? RULINGS.ADMIN_STANDING : r.expected === "SCOPED" ? "Security Role assignment scope (scoped holding)" : "eos_policy.role_capabilities (census 2026-10-21)", needsFixtures: false, note: r.note || undefined });
}
for (const r of m.personaCredRows) {
  rows.push({ id: `${r.persona}:cred:${r.object}:${r.verb}`, persona: r.persona, tier: "cred", roles: pe.get(r.persona).globalRoles.join("+"), company: "n/a", object: r.object, action: r.verb, expected: r.expected, basis: r.basis,
    source: r.verb === "D" ? "policySeedSnapshot.json supportsDelete=false; census can_delete true in 0 rows" : "eos_policy.role_object_permissions (census 2026-10-21) + capabilitiesByVerb (policySeedSnapshot.json)", needsFixtures: false, undetermined: r.undetermined || undefined });
}
for (const p of m.personas) for (const d of m.destinations.filter((x) => x.status === "BUILT")) {
  const visible = p.destinations.includes(d.destination);
  rows.push({ id: `${p.key}:nav:${d.destination}`, persona: p.key, tier: "navigation", roles: p.globalRoles.join("+"), company: "n/a", object: d.objects.join("|"), action: `destination ${d.path}`, expected: visible ? "VISIBLE" : "HIDDEN",
    basis: d.surfaceAccess.length ? `surface(s) ${d.surfaceAccess.join(" | ")}: ${visible ? "granted" : "not granted"}` : d.containerScope ? "container derived from reachable children" : "no governed surface: invisible to every principal under the EOS navigation source (static finding NF-01; verify live)",
    source: "navConfig.js NAV_SURFACE_ACCESS + experienceAuthority.ts EXPERIENCE_SURFACES", needsFixtures: false });
}
for (const r of m.personaWfRows) rows.push({ id: `${r.persona}:workflow:${r.workflow}:${r.action}`, persona: r.persona, tier: "workflow", roles: pe.get(r.persona).globalRoles.join("+"), company: "reach-dependent", object: r.workflow, action: `${r.action} (${r.from} -> ${r.to})`, capability: r.capability, expected: r.expected, basis: r.basis, source: "workflowSeeds.ts (role bindings) + capability; a binding never grants", needsFixtures: true });
for (const r of m.probeRows) rows.push({ id: `${r.persona}:api:${r.route}:${r.op}`, persona: r.persona, tier: "api-probe", roles: r.basis, company: r.reach || "n/a", object: r.object, action: `${r.route} ${r.op}`, capability: r.capability, expected: r.expected, basis: r.expectedRefusal || r.basis, source: "census role_capabilities + probe gate table (uatProbes.mjs)", needsFixtures: false, kindOfCall: r.kind });
for (const r of buildRecordRows(m)) rows.push({ roles: pe.get(r.persona).globalRoles.join("+"), object: r.recordKind, action: r.op, ...r });
for (const r of buildSearchRows(m)) rows.push({ roles: pe.get(r.persona).globalRoles.join("+"), action: r.op, ...r });
for (const r of buildDashboardRows(m)) rows.push({ roles: pe.get(r.persona).globalRoles.join("+"), action: r.op, ...r });
for (const r of buildAnalysisRows(m)) rows.push({ roles: pe.get(r.persona).globalRoles.join("+"), action: r.op, ...r });
for (const r of buildRouteRows(m)) rows.push({ roles: pe.get(r.persona).globalRoles.join("+"), action: r.op, ...r });
for (const r of buildDecisionRows(m)) rows.push({ roles: pe.get(r.persona).globalRoles.join("+"), action: r.op, ...r });

// ------------------------------------------------------------------ field-level (rule rows, counted not expanded)
const fieldStats = { visiblePositive: 0, editPositive: 0, doorwayNegatives: 0, perPersona: {} };
const objFields = new Map(m.objects.filter((o) => o.registered).map((o) => [o.key, o.fieldsCensus ?? 0]));
for (const p of m.personas) {
  let v = 0, e = 0, d = 0;
  for (const [obj, n] of objFields) {
    if (!n) continue;
    const rd = m.personaCredRows.find((r) => r.persona === p.key && r.object === obj && r.verb === "R");
    const ed = m.personaCredRows.find((r) => r.persona === p.key && r.object === obj && r.verb === "E");
    if (rd.expected === "ALLOW" || rd.expected === "SCOPED") v += n; else d += 1;
    if (ed.expected === "ALLOW" || ed.expected === "SCOPED") e += n;
  }
  fieldStats.perPersona[p.key] = { visible: v, edit: e, doorwayNegatives: d };
  fieldStats.visiblePositive += v; fieldStats.editPositive += e; fieldStats.doorwayNegatives += d;
}

// ------------------------------------------------------------------ classify every row (run status) and count
const BLOCKED_STATES = new Set(["UNDETERMINED"]);
function runStatus(r) {
  if (r.expected === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (BLOCKED_STATES.has(r.expected)) return "BLOCKED_OWNER_QUESTION";
  if (r.dependsOn?.length) return "BLOCKED_UNMERGED_PR";
  if (r.needsFixtures && (r.recordKind?.startsWith("V-") || r.recordKind?.startsWith("X-") || r.company === "ventana")) return "NEEDS_VENTANA_FIXTURES";
  if (r.tier === "record-reach") return "NEEDS_RECORDS_UNVERIFIED";
  if (r.tier === "workflow" || r.tier === "sae-self-approval" || (r.tier === "direct-route" && r.needsFixtures)) return "NEEDS_RECORDS_UNVERIFIED";
  return "RUN_NOW";
}
for (const r of rows) r.runStatus = runStatus(r);
const tiers = [...new Set(rows.map((r) => r.tier))];
const statuses = ["RUN_NOW", "NEEDS_RECORDS_UNVERIFIED", "NEEDS_VENTANA_FIXTURES", "BLOCKED_UNMERGED_PR", "BLOCKED_OWNER_QUESTION", "NOT_APPLICABLE"];
const matrix = Object.fromEntries(tiers.map((t) => [t, Object.fromEntries(statuses.map((s) => [s, rows.filter((r) => r.tier === t && r.runStatus === s).length]))]));
for (const t of tiers) matrix[t].TOTAL = rows.filter((r) => r.tier === t).length;
const totals = Object.fromEntries([...statuses, "TOTAL"].map((s) => [s, s === "TOTAL" ? rows.length : rows.filter((r) => r.runStatus === s).length]));
const expectedCounts = Object.fromEntries(["ALLOW", "DENY", "SCOPED", "VISIBLE", "HIDDEN", "PRESENT", "CONDITIONAL", "UNDETERMINED", "NOT_APPLICABLE", "ALLOW_PREVIEW_ONLY"].map((e) => [e, rows.filter((r) => r.expected === e).length]));

// role level (A/C) cells
const roleLevel = { roleCapabilityCells: m.roles.length * m.census.capabilities.length, roleCredCells: m.roles.length * m.census.objects.length * 4, roleReadbackCalls: m.roles.length };

const model = { m, rows, fieldStats, matrix, totals, expectedCounts, roleLevel, PIN, tiers, statuses };

// ------------------------------------------------------------------ write
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
const dataDir = path.join(REPO_DOCS, "data");
const handoff = path.join(REPO_DOCS, "codex-handoff");

// manifest (machine readable, read-only)
const sourceIds = new Map();
for (const r of rows) if (!sourceIds.has(r.source)) sourceIds.set(r.source, "S" + String(sourceIds.size + 1).padStart(2, "0"));
const personaMeta = m.personas.map((p) => ({
  key: p.key, principalId: p.principalId, display: p.display, employeeId: p.employeeId, employeeName: p.employeeName, jobRoleId: p.jobRoleId, homeCompany: p.homeCompany,
  securityRoles: { global: p.globalRoles, scoped: p.scoped }, ignoredDisabledAssignments: p.disabled,
  companyReach: { operational: p.companyReach, why: p.companyReachWhy, finance: p.financeReach }, salesChannels: p.channels, operationalScopes: p.operationalScopes, declaredWorkEligibility: p.declaredEligibility,
  protectedAdministratorStanding: p.standing, protectedOwner: p.globalRoles.includes("owner"), effectiveCapabilityCount: { flat: p.flatCaps.size, derivedByStanding: p.derived, scopedOnly: [...p.scopedCaps.keys()].filter((k) => !p.flatCaps.has(k)).length },
  expectedSurfaces: p.surfaces, expectedVisibleDestinations: p.destinations,
  login: { mechanism: "EOS password + MFA", mfaRequired: true, enrollmentSource: "EOS_PERSONA_CREDENTIALS_FILE (operator-set; never discovered)", expectedResolvedAfterLogin: { principalId: p.principalId, employeeId: p.employeeId, securityRoleKeys: [...p.globalRoles, ...p.scoped.map((s) => `${s.role}@${s.scopeType}=${s.scopeValue}`)], companyAuthority: p.companyReach } },
}));
const manifest = {
  schema: "eos.uat.expected-access-manifest/1", readOnly: true,
  note: "EXPECTED access derived from governed authority (the permission resolver's inputs: eos_policy role_capabilities, role_object_permissions, scoped assignments, company authority, surface catalog) and cited Owner rulings -- never from role names. Names only: no credential, token or secret is in this file.",
  pin: { repoCommit: PIN, censusFile: path.basename(CENSUS), censusDate: "2026-10-21", migrationsExpected: 118, migrationsNote: "count of functions/migrations/*.sql at the pinned commit; compare to GET /health migrations" },
  dependsOnUnmergedPrs: { "#2200": "DWO Work Order company boundary", "#2199": "CLC company-less record correction", "#2201": "persona harness target allowlist (tooling)" },
  vocabulary: { expected: { ALLOW: "permitted (subject to the record-level conditions in `basis`)", DENY: "refused (a foreign-company or conditioned record is NONEXISTENT: identical not-found)", SCOPED: "permitted only inside the stated scope (sales channel, company, warehouse)", VISIBLE: "offered in navigation", HIDDEN: "not offered", PRESENT: "dashboard section present in the persona layout", CONDITIONAL: "permitted only on the caller's own assignment", UNDETERMINED: "no governed expectation exists: do NOT assert; report observed behaviour (Owner question in docs/uat/07-owner-questions.md)", NOT_APPLICABLE: "no such act exists", ALLOW_PREVIEW_ONLY: "permitted; UAT may preview but must never commit" },
    runStatus: Object.fromEntries(statuses.map((s) => [s, s])) },
  personas: personaMeta,
  objects: m.objects.map((o) => ({ key: o.key, label: o.label, registered: o.registered, fields: o.fieldsCensus, sensitiveFields: o.sensitiveFields, capabilities: o.capabilities.map((c) => c.key), pages: o.pages, extraRoutes: o.extraRoutes, apiOperations: o.opCount })),
  fieldRule: { expectation: "A field inherits its Object's read/edit unless a Role field override exists (effectiveObjectAccess.ts rules 2-4: the doorway invariant -- a field grant never opens an Object). Overrides were 0 at the 2026-09-24 baseline; the 2026-10-21 census omitted them (CG-02).", counts: fieldStats },
  counts: { rows: rows.length, byTier: Object.fromEntries(tiers.map((t) => [t, matrix[t].TOTAL])), byExpected: expectedCounts, byRunStatus: totals },
  sources: Object.fromEntries([...sourceIds].map(([text, id]) => [id, text])),
  rows: rows.map((r) => { const o = { id: r.id, persona: r.persona, tier: r.tier, roles: r.roles, company: r.company, object: r.object, action: r.action, expected: r.expected, source: sourceIds.get(r.source), basis: r.basis, runStatus: r.runStatus };
    if (r.capability) o.capability = r.capability; if (r.dependsOn) o.dependsOn = r.dependsOn.map((x) => `after ${x}`); if (r.needsFixtures) o.needsFixtures = true; if (r.fixture) o.fixture = r.fixture; if (r.undetermined) o.undetermined = r.undetermined; if (r.recordKind) o.recordKind = r.recordKind; if (r.note) o.note = r.note; return o; }),
};
write(path.join(handoff, "expected-access-manifest.json"), JSON.stringify(manifest) + "\n");

// CSV data (repo: compact; evidence: full)
const nonDeny = rows.filter((r) => !["DENY", "HIDDEN"].includes(r.expected));
write(path.join(dataDir, "roles.csv"), toCsv(m.roles.map((r) => ({ ...r, activeAssignees: r.activeAssignees.join("; "), scopes: r.scopes.join("; "), flags: r.flags.join("|"), personaAssignees: r.personaAssignees.join("|") })), ["key", "name", "protected", "companyAuthorityEffect", "grants", "standingImplied", "effectiveForHolder", "activeAssignments", "disabledAssignments", "activeAssignees", "personaAssignees", "scopes", "credRows", "credCanRead", "credCanCreate", "credCanEdit", "flags"]));
write(path.join(dataDir, "personas.csv"), toCsv(m.personas.map((p) => ({ persona: p.key, principalId: p.principalId, employeeId: p.employeeId, employee: p.employeeName, jobRole: p.jobRoleId, homeCompany: p.homeCompany, globalRoles: p.globalRoles.join("|"), scopedRoles: p.scoped.map((s) => `${s.role}@${s.scopeType}=${s.scopeValue}`).join("|"), flatCaps: p.flatCaps.size, derivedByStanding: p.derived, scopedOnlyCaps: [...p.scopedCaps.keys()].filter((k) => !p.flatCaps.has(k)).length, operationalReach: p.companyReach.join("|"), financeReach: p.financeReach.join("|"), channels: p.channels.join("|"), operationalScopes: p.operationalScopes.join("|"), eligibility: p.declaredEligibility.join("|"), surfaces: p.surfaces.length, destinations: p.destinations.length })), ["persona", "principalId", "employeeId", "employee", "jobRole", "homeCompany", "globalRoles", "scopedRoles", "flatCaps", "derivedByStanding", "scopedOnlyCaps", "operationalReach", "financeReach", "channels", "operationalScopes", "eligibility", "surfaces", "destinations"]));
write(path.join(dataDir, "objects.csv"), toCsv(m.objects.map((o) => ({ ...o, capabilitiesN: o.capabilities.length, pagesList: o.pages.concat(o.extraRoutes).join("; "), rolesRead: o.rolesRead.length, rolesCreate: o.rolesCreate.length, rolesEdit: o.rolesEdit.length, rolesAnyCapability: o.rolesAnyCapability.length })), ["key", "label", "registered", "domain", "fieldsCensus", "fieldsSeed", "capabilitiesN", "credRows", "rolesRead", "rolesCreate", "rolesEdit", "rolesAnyCapability", "opCount", "hasPage", "hasApi", "pagesList"]));
write(path.join(dataDir, "destinations.csv"), toCsv(m.destinations.map((d) => ({ destination: d.destination, label: d.label, path: d.path, status: d.status, navHidden: d.navHidden, eosGate: d.eosGate, objects: d.objects.join("; "), confidence: d.objectConfidence, personasVisible: m.personas.filter((p) => p.destinations.includes(d.destination)).map((p) => p.key).join("|") })), ["destination", "label", "path", "status", "navHidden", "eosGate", "objects", "confidence", "personasVisible"]));
write(path.join(dataDir, "operations.csv"), toCsv(m.operations.map((o) => ({ route: o.route, operation: o.op, registries: o.registries.join("|"), object: o.object, confidence: o.confidence })), ["route", "operation", "registries", "object", "confidence"]));
write(path.join(dataDir, "role-capability-grants.csv"), toCsv(m.roleCapRows, ["role", "capability", "object", "action", "kind", "source"]));
write(path.join(dataDir, "role-object-cred.csv"), toCsv(m.census.role_object_permissions.map((p) => ({ role: p.role, object: p.object, create: p.can_create, read: p.can_read, edit: p.can_edit, delete: p.can_delete })), ["role", "object", "create", "read", "edit", "delete"]));
write(path.join(dataDir, "cred-capability-divergence.csv"), toCsv([...m.divergence.map((d) => ({ kind: "CRED_VS_CAPABILITY", ...d })), ...m.credOnly.map((d) => ({ kind: "CRED_TRUE_NO_ENFORCING_CAPABILITY", ...d, cred: true, capabilityHeld: "", capabilities: "" })), ...m.editWithoutRead.map((d) => ({ kind: "CREATE_OR_EDIT_WITHOUT_READ", role: d.role, object: d.object, verb: d.edit ? "E" : "C", cred: true, capabilityHeld: "", capabilities: "" }))], ["kind", "role", "object", "verb", "cred", "capabilityHeld", "capabilities"]));
write(path.join(dataDir, "expected-nondeny.csv"), toCsv(nonDeny.map((r) => ({ persona: r.persona, tier: r.tier, object: r.object, action: r.action, expected: r.expected, runStatus: r.runStatus, dependsOn: (r.dependsOn ?? []).join("|"), source: r.source })), ["persona", "tier", "object", "action", "expected", "runStatus", "dependsOn", "source"]));
write(path.join(dataDir, "denominators.json"), JSON.stringify({ pin: PIN, totals, matrix, expectedCounts, roleLevel, fieldStats, universe: { roles: m.roles.length, personas: 16, registeredObjects: m.census.objects.length, capabilityObjects: m.objects.length, capabilities: m.census.capabilities.length, builtDestinations: m.destinations.filter((d) => d.status === "BUILT").length, destinations: m.destinations.length, extraRoutes: 15, operations: m.operations.length, probes: PROBES.length, workflowActions: m.wfActions.length, recordKinds: RECORD_KINDS.length } }, null, 1) + "\n");

// docs
const docs = renderAll(model);
for (const [rel, text] of Object.entries(docs)) write(path.join(REPO_DOCS, rel), text);

// evidence copy (full dense detail, outside the repo)
if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  write(path.join(OUT, "expected-access-manifest.json"), JSON.stringify(manifest) + "\n");
  write(path.join(OUT, "expected-all-rows.csv"), toCsv(rows.map((r) => ({ id: r.id, persona: r.persona, tier: r.tier, object: r.object, action: r.action, expected: r.expected, runStatus: r.runStatus, dependsOn: (r.dependsOn ?? []).join("|"), source: r.source, basis: r.basis })), ["id", "persona", "tier", "object", "action", "expected", "runStatus", "dependsOn", "source", "basis"]));
  for (const f of ["roles.csv", "personas.csv", "objects.csv", "destinations.csv", "operations.csv", "role-capability-grants.csv", "role-object-cred.csv", "cred-capability-divergence.csv", "denominators.json"]) fs.copyFileSync(path.join(dataDir, f), path.join(OUT, f));
  const dense = [];
  for (const r of m.roles) for (const o of m.census.objects) { const p = m.census.role_object_permissions.find((x) => x.role === r.key && x.object === o.key); dense.push({ role: r.key, object: o.key, create: !!p?.can_create, read: !!p?.can_read, edit: !!p?.can_edit, delete: !!p?.can_delete }); }
  write(path.join(OUT, "role-object-cred-dense.csv"), toCsv(dense, ["role", "object", "create", "read", "edit", "delete"]));
  for (const rel of Object.keys(docs)) write(path.join(OUT, rel.replace(/\//g, "__")), docs[rel]);
}
console.log(JSON.stringify({ rows: rows.length, totals, expectedCounts }, null, 1));
