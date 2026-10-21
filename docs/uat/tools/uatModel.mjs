// UAT census -- the computed model. Pure functions over (a) the controller's read-only nonprod census JSON and (b) the repository.
// No database, no network, no credential. Every derived number in docs/uat is produced here.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, extractOperations, extractSurfaces, extractScopeEvaluable, extractNavigation, readRepoJson } from "./uatExtract.mjs";
import { OP_RULES, PAGE_OBJECTS, EXTRA_ROUTES, PLATFORM } from "./uatMaps.mjs";
import { PROBES } from "./uatProbes.mjs";

const csv = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => csv(r[c])).join(","))].join("\n") + "\n";
const uniq = (a) => [...new Set(a)];
const sorted = (a) => [...a].sort((x, y) => String(x).localeCompare(String(y)));

// ---- The protected Administrator's implied capabilities: a PURE PORT of functions/src/adminPolicy/protectedAdministrator.ts
// (isImpliedForProtectedAdministrator). The controller should confirm the port for the `administrator` persona with explainEffectiveAccess.
const SYS_OBJ = new Set(["rolesPermissions", "workflowDefinition", "principal", "employee", "auditLog", "dataImport", "systemConfiguration", "financeConfiguration"]);
const EXCLUDED = new Set(["reorder.request.read.queue", "salesAgreement.tradeIn.approve", "inventory.catalog.cost.read", "inventory.catalog.cost.create", "inventory.catalog.cost.edit"]);
const MGMT = new Set(["equipment.record.manage", "rental.fleet.manage", "reorder.request.approve", "reorder.request.reject", "reorder.request.cancel", "reorder.request.assign", "reorder.purchaseOrder.void", "inventory.receipt.correct", "ownership.handoff.correct"]);
const impliedForAdmin = (c) => !EXCLUDED.has(c.key) && (MGMT.has(c.key) || SYS_OBJ.has(c.object_key) || c.action_kind === "ADMIN_ACTION" || c.action_kind === "READ");
const ACCESS_ELIGIBLE = new Set(["ACTIVE", "CONTRACTOR"]);

// CRED cells that are governed by a NAMED BUSINESS ACT rather than a generic verb (functions/src/adminPolicy/migration/credEquivalence.ts SEMANTIC_REPLACEMENTS + WITHHELD)
const SEMANTIC_REPLACEMENTS = new Set(["workOrder.E", "salesOrder.C", "inventoryAction.E", "inventoryTransaction.E", "receivingOrder.E", "transferOrder.E", "invoice.C", "invoice.E", "payment.C", "payment.E", "employee.E", "inventoryAction.C", "rolesPermissions.E", "purchaseOrder.R", "purchaseOrder.C"]);
const VERBS = ["C", "R", "E", "D"];
const VCOL = { C: "can_create", R: "can_read", E: "can_edit", D: "can_delete" };

function parseWorkflowSeeds() {
  const src = fs.readFileSync(path.join(REPO_ROOT, "functions", "src", "adminPolicy", "workflowSeeds.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out = [];
  let cur = null;
  for (const line of src.split("\n")) {
    const wf = /^\s*key:\s*"([A-Za-z]+)",\s*$/.exec(line);
    if (wf && /^\s{2}key:/.test(line)) { cur = { key: wf[1], actions: [] }; out.push(cur); continue; }
    const a = /\{\s*key:\s*"([A-Za-z]+)",\s*label:\s*"([^"]*)",\s*from:\s*"([A-Z_]+)",\s*to:\s*"([A-Z_]+)",(.*)roleKeys:\s*\[([^\]]*)\]/.exec(line);
    if (a && cur) {
      out.push; cur.actions.push({
        key: a[1], label: a[2], from: a[3], to: a[4],
        ownAssignment: /requiresOwnAssignment:\s*true/.test(a[5]),
        capabilityId: /capabilityId:\s*"([^"]+)"/.exec(a[5])?.[1] ?? null,
        roleKeys: [...a[6].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]),
      });
    }
  }
  return out.filter((w) => w.actions && w.actions.length);
}

export async function buildModel(censusPath) {
  const C = JSON.parse(fs.readFileSync(censusPath, "utf8"));
  const SNAP = readRepoJson("functions/src/adminPolicy/seed/policySeedSnapshot.json");
  const PD = readRepoJson("functions/scripts/fixtures/personaAuthorityDimensions.v1.json");

  const roleByKey = new Map(C.roles.map((r) => [r.key, r]));
  const capByKey = new Map(C.capabilities.map((c) => [c.key, c]));
  const objByKey = new Map(C.objects.map((o) => [o.key, o]));
  const snapObj = new Map(SNAP.objects.map((o) => [o.key, o]));
  const grantsByRole = new Map(C.roles.map((r) => [r.key, new Set()]));
  for (const g of C.role_capabilities) grantsByRole.get(g.role).add(g.cap);
  const impliedKeys = new Set(C.capabilities.filter(impliedForAdmin).map((c) => c.key));
  const prin = new Map(C.principals.map((p) => [p.id, p]));
  const idn = new Map(C.principal_identities.map((i) => [i.principal_id, i]));
  const empById = new Map(C.employees.map((e) => [e.id, e]));
  const credBy = new Map(C.role_object_permissions.map((p) => [p.role + "|" + p.object, p]));
  const fieldsCensus = new Map(C.object_field_counts.map((f) => [f.key, +f.fields]));
  const jobRoleOf = new Map(C.employee_job_role_assignments.filter((j) => !j.effective_to && !j.ended_at).map((j) => [j.employee_id, j.job_role_id]));
  const jobRoleLabel = new Map(C.job_roles.map((j) => [j.id, j.display_name]));

  const principalLabel = (pid) => {
    const i = idn.get(pid); const p = prin.get(pid);
    if (i?.external_subject.startsWith("nonprod-persona.")) return `persona:${i.external_subject.slice(16)}`;
    if (i) return `user:${p?.display_name ?? i.external_subject}`;
    return `fixture:${(p?.display_name ?? pid).replace(/\s*\(fixture, cannot sign in\)/, "")}`;
  };
  const personaKeyOf = (pid) => { const i = idn.get(pid); return i?.external_subject.startsWith("nonprod-persona.") ? i.external_subject.slice(16) : null; };
  const PERSONAS = C.principal_identities.filter((i) => i.external_subject.startsWith("nonprod-persona.")).map((i) => i.external_subject.slice(16));
  const PERSONA_ORDER = ["ownerExecutive", "administrator", "generalManager", "officeManager", "serviceManager", "dispatcher", "serviceTechnician", "partsAssociate", "partsManager", "warehouseAssociate", "warehouseManager", "retailSales", "nationalAccountsSales", "financeAccounting", "reportingAnalyst", "generalEmployee"];
  const personaKeys = PERSONA_ORDER.filter((k) => PERSONAS.includes(k));
  if (personaKeys.length !== 16) throw new Error(`expected 16 governed personas, found ${personaKeys.length}`);

  // ---------------------------------------------------------------- A. Security Role inventory
  const assignmentsByRole = new Map();
  for (const a of C.role_assignments) { if (!assignmentsByRole.has(a.role)) assignmentsByRole.set(a.role, []); assignmentsByRole.get(a.role).push(a); }
  const memberActive = (pid) => prin.get(pid)?.status === "active" && prin.get(pid)?.membership === "active";
  const roles = C.roles.map((r) => {
    const as = assignmentsByRole.get(r.key) ?? [];
    const act = as.filter((a) => a.status === "active");
    const lbl = (a) => principalLabel(a.principal_id) + (a.scope_type === "global" ? "" : `@${a.scope_type}=${a.extra?.scope_value}`);
    const activeAssignees = uniq(act.map(lbl));
    const loginActive = act.filter((a) => memberActive(a.principal_id));
    const grants = grantsByRole.get(r.key);
    const flags = [];
    if (act.length === 0) flags.push("NO_ACTIVE_ASSIGNEE");
    else if (loginActive.length === 0) flags.push("ONLY_NON_LOGIN_FIXTURE_ASSIGNEES");
    if (grants.size === 0) flags.push("NO_CAPABILITY_GRANTS");
    if (/^zz_|temporary/i.test(r.key + " " + r.name)) flags.push("TEST_OR_TEMPORARY_ROLE");
    if (r.company_authority_effect === "FINANCE_ONLY") flags.push("FINANCE_ONLY");
    if (r.protected) flags.push("PROTECTED");
    const credRows = C.role_object_permissions.filter((p) => p.role === r.key);
    return {
      key: r.key, name: r.name, protected: r.protected, companyAuthorityEffect: r.company_authority_effect,
      grants: grants.size, standingImplied: r.key === "admin" ? [...impliedKeys].filter((k) => !grants.has(k)).length : 0,
      effectiveForHolder: r.key === "admin" ? new Set([...grants, ...impliedKeys]).size : grants.size,
      activeAssignments: act.length, disabledAssignments: as.length - act.length,
      activeAssignees, personaAssignees: uniq(act.map((a) => personaKeyOf(a.principal_id)).filter(Boolean)),
      scopes: uniq(act.filter((a) => a.scope_type !== "global").map((a) => `${a.scope_type}=${a.extra?.scope_value}`)),
      credRows: credRows.length, credCanRead: credRows.filter((p) => p.can_read).length, credCanCreate: credRows.filter((p) => p.can_create).length, credCanEdit: credRows.filter((p) => p.can_edit).length,
      flags,
    };
  });

  // ---------------------------------------------------------------- principal inventory / persona inventory
  const linkActive = new Map();
  for (const l of C.employee_principal_links) if (l.status === "active") { if (!linkActive.has(l.principal_id)) linkActive.set(l.principal_id, []); linkActive.get(l.principal_id).push(l.employee_id); }
  const scopesOf = (eid) => C.employee_operational_scopes.filter((s) => s.employee_id === eid && !s.effective_to && !s.ended_at);
  const grantsOf = (eid) => C.employee_company_authority_grants.filter((g) => g.employee_id === eid && g.status === "active" && !g.effective_until);
  const declaredElig = new Map();
  for (const w of PD.workEligibility ?? []) { const id = "synthetic-np-emp-" + w.employee; if (!declaredElig.has(id)) declaredElig.set(id, new Set()); declaredElig.get(id).add(w.qualificationCode); }

  const surfaces = extractSurfaces();
  const surfByKey = new Map(surfaces.map((s) => [s.key, s]));
  const scopeEval = extractScopeEvaluable();

  function holdingsOf(pid) {
    const all = C.role_assignments.filter((a) => a.principal_id === pid);
    const act = all.filter((a) => a.status === "active");
    const globalRoles = sorted(uniq(act.filter((a) => a.scope_type === "global").map((a) => a.role)));
    const scoped = act.filter((a) => a.scope_type !== "global").map((a) => ({ role: a.role, scopeType: a.scope_type, scopeValue: a.extra?.scope_value ?? null }));
    const disabled = uniq(all.filter((a) => a.status !== "active").map((a) => `${a.role}/${a.scope_type}${a.scope_type === "global" ? "" : "=" + a.extra?.scope_value}`));
    return { globalRoles, scoped, disabled };
  }
  function flatCapsOf(globalRoles) {
    const caps = new Set(); const src = new Map();
    for (const r of globalRoles) for (const c of grantsByRole.get(r) ?? []) { caps.add(c); if (!src.has(c)) src.set(c, []); src.get(c).push(r); }
    const standing = globalRoles.includes("admin") && roleByKey.get("admin")?.protected === true && !globalRoles.includes("owner");
    let derived = 0;
    if (standing) for (const k of impliedKeys) if (!caps.has(k)) { caps.add(k); src.set(k, ["admin(STANDING)"]); derived++; }
    return { caps, src, standing, derived };
  }

  const personas = personaKeys.map((key) => {
    const idRow = C.principal_identities.find((i) => i.external_subject === "nonprod-persona." + key);
    const pid = idRow.principal_id;
    const h = holdingsOf(pid);
    const f = flatCapsOf(h.globalRoles);
    const empIds = linkActive.get(pid) ?? [];
    const eid = empIds.length === 1 ? empIds[0] : null;
    const emp = eid ? empById.get(eid) : null;
    const scopedCaps = new Map(); // cap -> [{scopeType, scopeValue, role}]
    for (const s of h.scoped) for (const c of grantsByRole.get(s.role) ?? []) { if (!scopedCaps.has(c)) scopedCaps.set(c, []); scopedCaps.get(c).push(s); }
    // company reach (companyAuthority.ts): home + OPERATIONAL operatingCompany-scoped roles + explicit grants. Finance reach is separate.
    const reach = new Set(); const reachWhy = [];
    if (emp && ACCESS_ELIGIBLE.has(emp.employment_status)) {
      reach.add(emp.operating_company_id); reachWhy.push(`home:${emp.operating_company_id}`);
      for (const s of h.scoped) if (s.scopeType === "operatingCompany" && roleByKey.get(s.role)?.company_authority_effect === "OPERATIONAL") { reach.add(s.scopeValue); reachWhy.push(`role:${s.role}=${s.scopeValue}`); }
      for (const g of grantsOf(eid)) { reach.add(g.operating_company_id); reachWhy.push(`grant:${g.operating_company_id}`); }
    }
    const financeReach = uniq(h.scoped.filter((s) => s.scopeType === "operatingCompany" && (grantsByRole.get(s.role)?.has("finance.payment.read"))).map((s) => s.scopeValue));
    const channels = uniq(h.scoped.filter((s) => s.scopeType === "salesChannel").map((s) => s.scopeValue));
    const empScopes = eid ? scopesOf(eid) : [];
    const elig = eid ? [...(declaredElig.get(eid) ?? [])] : [];
    return {
      key, principalId: pid, display: prin.get(pid)?.display_name, employeeId: eid, employeeName: emp?.display_name ?? null, employeeStatus: emp?.employment_status ?? null,
      homeCompany: emp?.operating_company_id ?? null, jobRole: eid ? (jobRoleLabel.get(jobRoleOf.get(eid)) ?? null) : null, jobRoleId: eid ? jobRoleOf.get(eid) ?? null : null,
      globalRoles: h.globalRoles, scoped: h.scoped, disabled: h.disabled,
      flatCaps: f.caps, capSource: f.src, standing: f.standing, derived: f.derived, scopedCaps,
      companyReach: sorted(reach), companyReachWhy: reachWhy, financeReach: sorted(financeReach), channels,
      operationalScopes: empScopes.map((s) => `${s.scope_type}:${s.scope_id}`), declaredEligibility: elig,
      links: empIds.length,
    };
  });
  const personaByKey = new Map(personas.map((p) => [p.key, p]));

  // principals without any active role / roles without assignee
  const principalsNoRole = C.principals.filter((p) => !C.role_assignments.some((a) => a.principal_id === p.id && a.status === "active")).map((p) => ({ id: p.id, label: principalLabel(p.id), status: p.status, membership: p.membership }));
  const personasNoRole = personas.filter((p) => p.globalRoles.length === 0 && p.scoped.length === 0).map((p) => p.key);
  const personasZeroCaps = personas.filter((p) => p.flatCaps.size === 0 && p.scopedCaps.size === 0).map((p) => p.key);
  const rolesNoAssignee = roles.filter((r) => r.flags.includes("NO_ACTIVE_ASSIGNEE")).map((r) => r.key);

  // ---------------------------------------------------------------- surfaces / navigation (EOS navigation source)
  function surfaceGranted(p, s, memo = new Map()) {
    if (memo.has(s.key)) return memo.get(s.key);
    let res = { granted: false, why: "no grant path satisfied" };
    if (s.container) {
      const kids = s.children.filter((k) => surfaceGranted(p, surfByKey.get(k), memo).granted);
      res = kids.length ? { granted: true, why: `container: ${kids.join(", ")}` } : { granted: false, why: "container: no child reachable" };
    } else {
      for (const path_ of s.paths) {
        const flat = p.flatCaps.has(path_.capabilityKey);
        if (flat) {
          const needScopes = path_.scopes.filter((t) => !p.operationalScopes.some((x) => x.startsWith(t + ":")));
          const needElig = path_.eligibility.filter((c) => !p.declaredEligibility.includes(c));
          if (needScopes.length === 0 && needElig.length === 0) { res = { granted: true, why: `flat ${path_.capabilityKey}` + (path_.scopes.length || path_.eligibility.length ? ` + ${[...path_.eligibility, ...path_.scopes].join("+")}` : "") }; break; }
          res.why = `holds ${path_.capabilityKey} but lacks ${[...needElig.map((c) => "WORK_ELIGIBILITY " + c), ...needScopes.map((t) => "OPERATIONAL_SCOPE " + t)].join(" and ")}`;
        } else if (path_.scopedConsumer && p.scopedCaps.get(path_.capabilityKey)?.some((x) => x.scopeType === path_.scopedConsumer.scopeType)) {
          res = { granted: true, why: `scoped ${path_.capabilityKey} (${path_.scopedConsumer.scopeType})` }; break;
        }
      }
    }
    memo.set(s.key, res);
    return res;
  }

  const nav = await extractNavigation();
  const destinations = nav.rows.map((r) => {
    const po = PAGE_OBJECTS[r.destination];
    return { ...r, status: r.hasComponentBranch ? "BUILT" : "PLACEHOLDER", objects: po ? po[0] : [], objectConfidence: po ? po[1] : "?",
      eosGate: r.containerScope ? "container (derived from reachable children)" : r.surfaceAccess.length ? `surface: ${r.surfaceAccess.join(" | ")}` : "NO governed surface => invisible to every principal under the EOS navigation source" };
  });
  for (const p of personas) {
    const memo = new Map();
    p.surfaces = surfaces.filter((s) => surfaceGranted(p, s, memo).granted).map((s) => s.key);
    p.surfaceWhyNot = surfaces.filter((s) => !surfaceGranted(p, s, memo).granted).map((s) => ({ key: s.key, why: memo.get(s.key).why }));
    const sg = new Set(p.surfaces);
    const visible = (d) => {
      if (d.containerScope) {
        const scope = d.containerScope;
        return destinations.some((c) => c !== d && !c.containerScope && !c.navHidden && (scope === "*" || scope.includes(c.destination) || scope.includes(c.domain)) && visibleLeaf(c, sg));
      }
      return visibleLeaf(d, sg);
    };
    p.destinations = destinations.filter((d) => d.status === "BUILT" && visible(d)).map((d) => d.destination);
  }
  function visibleLeaf(d, sg) { return d.surfaceAccess.length > 0 && d.surfaceAccess.some((k) => sg.has(k)); }
  const orphans = destinations.filter((d) => d.status === "BUILT" && !d.containerScope && d.surfaceAccess.length === 0);

  // ---------------------------------------------------------------- operations
  const opx = extractOperations();
  const operations = opx.operations.map((o) => {
    let obj = null, conf = "?";
    for (const [re, ob, cf] of OP_RULES) if (re.test(o.op)) { obj = ob; conf = cf; break; }
    return { ...o, object: obj ?? "(UNMAPPED)", confidence: conf };
  });

  // ---------------------------------------------------------------- B. Business Objects
  const capsByObj = new Map();
  for (const c of C.capabilities) { if (!capsByObj.has(c.object_key)) capsByObj.set(c.object_key, []); capsByObj.get(c.object_key).push(c); }
  const extraRoutesByObj = new Map();
  for (const r of EXTRA_ROUTES) for (const o of r.objects) { if (!extraRoutesByObj.has(o)) extraRoutesByObj.set(o, []); extraRoutesByObj.get(o).push(r.path); }
  const objectKeys = uniq([...C.objects.map((o) => o.key), ...C.capabilities.map((c) => c.object_key)]);
  const objects = objectKeys.map((key) => {
    const reg = objByKey.get(key);
    const so = snapObj.get(key);
    const caps = capsByObj.get(key) ?? [];
    const pages = destinations.filter((d) => d.status === "BUILT" && d.objects.includes(key)).map((d) => d.destination);
    const extra = extraRoutesByObj.get(key) ?? [];
    const ops = operations.filter((o) => o.object === key);
    const credRows = C.role_object_permissions.filter((p) => p.object === key);
    const heldBy = (fn) => roles.filter((r) => fn(r.key)).map((r) => r.key);
    const rolesRead = credRows.filter((p) => p.can_read).map((p) => p.role);
    const rolesCreate = credRows.filter((p) => p.can_create).map((p) => p.role);
    const rolesEdit = credRows.filter((p) => p.can_edit).map((p) => p.role);
    const rolesCap = heldBy((rk) => caps.some((c) => grantsByRole.get(rk).has(c.key) || (rk === "admin" && impliedKeys.has(c.key))));
    const sens = so ? so.fields.filter((f) => f.sensitivity !== "NORMAL").map((f) => f.key) : [];
    return {
      key, label: reg?.label ?? so?.label ?? key, registered: !!reg, origin: reg?.origin ?? null, lifecycle: reg?.lifecycle ?? null, domain: so?.domain ?? null,
      fieldsCensus: reg ? fieldsCensus.get(key) ?? 0 : null, fieldsSeed: so ? so.fields.length : null, sensitiveFields: sens,
      supportsDelete: so?.supportsDelete ?? null,
      capabilities: caps.map((c) => ({ key: c.key, action: c.action_key, kind: c.action_kind })),
      credRows: credRows.length, rolesCreate, rolesRead, rolesEdit, rolesAnyCapability: rolesCap,
      pages, extraRoutes: extra, operations: ops.map((o) => `${o.route}:${o.op}`), opCount: ops.length,
      hasPage: pages.length + extra.length > 0, hasApi: ops.length > 0,
    };
  });

  // ---------------------------------------------------------------- C. EXPECTED matrix
  // C1/C2: role level.
  const roleCapRows = [];
  for (const r of C.roles) for (const k of sorted(grantsByRole.get(r.key))) roleCapRows.push({ role: r.key, capability: k, object: capByKey.get(k).object_key, action: capByKey.get(k).action_key, kind: capByKey.get(k).action_kind, source: "DB role_capabilities" });
  for (const k of sorted(impliedKeys)) if (!grantsByRole.get("admin").has(k)) roleCapRows.push({ role: "admin", capability: k, object: capByKey.get(k).object_key, action: capByKey.get(k).action_key, kind: capByKey.get(k).action_kind, source: "DERIVED: protected Administrator standing (holder must not also hold owner)" });

  // CRED vs capability divergence (role level)
  const divergence = [];
  const credOnly = []; // CRED true on a verb no EOS capability governs
  const editWithoutRead = [];
  for (const p of C.role_object_permissions) {
    if ((p.can_create || p.can_edit) && !p.can_read) editWithoutRead.push({ role: p.role, object: p.object, create: p.can_create, edit: p.can_edit });
  }
  const verbCaps = (obj, v) => ((snapObj.get(obj)?.capabilitiesByVerb?.[v] ?? []).filter((k) => capByKey.has(k)));
  for (const r of C.roles) for (const o of C.objects) for (const v of ["C", "R", "E"]) {
    const cred = credBy.get(r.key + "|" + o.key)?.[VCOL[v]] === true;
    const vc = verbCaps(o.key, v);
    if (SEMANTIC_REPLACEMENTS.has(`${o.key}.${v}`)) continue;
    if (vc.length === 0) { if (cred) credOnly.push({ role: r.key, object: o.key, verb: v }); continue; }
    const held = vc.some((k) => grantsByRole.get(r.key).has(k));
    if (held !== cred) divergence.push({ role: r.key, object: o.key, verb: v, cred, capabilityHeld: held, capabilities: vc.join("|") });
  }

  // Persona level: capability matrix, CRED matrix, undetermined
  const personaCapRows = [];
  for (const p of personas) {
    for (const c of C.capabilities) {
      const flat = p.flatCaps.has(c.key);
      const sc = p.scopedCaps.get(c.key);
      let expected, basis;
      if (flat) { expected = "ALLOW"; basis = (p.capSource.get(c.key) ?? []).join("+"); }
      else if (sc) { expected = "SCOPED"; basis = sc.map((s) => `${s.role}@${s.scopeType}=${s.scopeValue}`).join("+"); }
      else { expected = "DENY"; basis = "no Security Role grant"; }
      let undetermined = "";
      if (!objByKey.has(c.object_key)) undetermined = "OBJECT_NOT_REGISTERED_IN_NONPROD";
      personaCapRows.push({ persona: p.key, object: c.object_key, action: c.action_key, kind: c.action_kind, capability: c.key, expected: undetermined ? (expected === "DENY" ? "DENY" : "UNDETERMINED") : expected, basis, undetermined });
    }
  }
  const personaCredRows = [];
  for (const p of personas) {
    for (const o of C.objects) for (const v of VERBS) {
      const glob = p.globalRoles.some((r) => credBy.get(r + "|" + o.key)?.[VCOL[v]] === true);
      const scp = !glob && p.scoped.some((s) => credBy.get(s.role + "|" + o.key)?.[VCOL[v]] === true);
      const cred = glob ? "ALLOW" : scp ? "SCOPED" : "DENY";
      let expected = cred, basis = "CRED union over held Security Roles", undetermined = "";
      if (v === "D") { expected = "DENY"; basis = "no delete verb exists for any Object (supportsDelete=false everywhere; can_delete true in 0 rows)"; if (cred !== "DENY") undetermined = "CRED_DELETE_TRUE"; }
      else if (SEMANTIC_REPLACEMENTS.has(`${o.key}.${v}`)) { basis = "generic verb replaced by named business act (see capability rows)"; expected = cred === "ALLOW" ? "UNDETERMINED" : cred; if (cred === "ALLOW") undetermined = "CRED_ALLOWS_VERB_REPLACED_BY_NAMED_ACT"; }
      else {
        const vc = verbCaps(o.key, v);
        if (vc.length === 0) { if (cred !== "DENY") { expected = "UNDETERMINED"; undetermined = "CRED_ONLY_NO_ENFORCING_CAPABILITY"; } basis = "no EOS capability governs this verb"; }
        else {
          const capHeld = vc.some((k) => p.flatCaps.has(k));
          const capScoped = !capHeld && vc.some((k) => p.scopedCaps.has(k));
          const capV = capHeld ? "ALLOW" : capScoped ? "SCOPED" : "DENY";
          if (capV === cred) { expected = cred; basis = `CRED and capability agree (${vc.join("|")})`; }
          else { expected = "UNDETERMINED"; undetermined = "CRED_DISAGREES_WITH_CAPABILITY"; basis = `CRED=${cred} but capability(${vc.join("|")})=${capV}`; }
        }
      }
      personaCredRows.push({ persona: p.key, object: o.key, verb: v, expected, basis, undetermined });
    }
  }

  // Workflow actions
  const wfSeeds = parseWorkflowSeeds();
  const wfActions = [];
  for (const w of wfSeeds) for (const a of w.actions) wfActions.push({ workflow: w.key, ...a });
  const bindingCounts = Object.fromEntries(wfSeeds.map((w) => [w.key, w.actions.reduce((n, a) => n + a.roleKeys.length, 0)]));
  const censusBindings = Object.fromEntries(C.workflows.map((w) => [w.key, +w.bindings]));
  const personaWfRows = [];
  for (const p of personas) for (const a of wfActions) {
    const bound = a.roleKeys.some((r) => p.globalRoles.includes(r));
    const boundScoped = !bound && a.roleKeys.some((r) => p.scoped.some((s) => s.role === r));
    const cap = a.capabilityId ? (p.flatCaps.has(a.capabilityId) ? "ALLOW" : p.scopedCaps.has(a.capabilityId) ? "SCOPED" : "DENY") : "NO_CAPABILITY";
    let expected, basis;
    if (!a.capabilityId) { expected = "UNDETERMINED"; basis = "action names no capability (cannot be published/executed)"; }
    else if (!bound && !boundScoped) { expected = "DENY"; basis = "no held Security Role is bound to the action"; }
    else if (cap === "DENY") { expected = "DENY"; basis = "bound role but capability not held (a binding never grants)"; }
    else { expected = a.ownAssignment ? "CONDITIONAL" : (cap === "SCOPED" || boundScoped ? "SCOPED" : "ALLOW"); basis = (a.ownAssignment ? "own assignment required; " : "") + `bound role + ${a.capabilityId}`; }
    personaWfRows.push({ persona: p.key, workflow: a.workflow, action: a.key, from: a.from, to: a.to, capability: a.capabilityId ?? "", expected, basis });
  }

  // ---------------------------------------------------------------- probes (API negative tests)
  const probeRows = [];
  const probeProblems = [];
  for (const pr of PROBES) { if (!capByKey.has(pr.cap)) probeProblems.push(`probe ${pr.op}: capability ${pr.cap} is not in the census`); if (!operations.some((o) => o.op === pr.op && o.route === pr.route)) probeProblems.push(`probe ${pr.route}:${pr.op} is not in any registry`); }
  for (const p of personas) for (const pr of PROBES) {
    const flat = p.flatCaps.has(pr.cap); const sc = p.scopedCaps.get(pr.cap);
    const expected = flat ? "ALLOW" : sc ? "SCOPED" : "DENY";
    let reach = "";
    if (pr.finance) reach = `finance companies: ${p.financeReach.join(",") || "none"}`;
    else if (pr.company) reach = `operating companies: ${p.companyReach.join(",") || "none"}`;
    probeRows.push({ persona: p.key, route: pr.route, op: pr.op, object: pr.object, kind: pr.kind, capability: pr.cap, expected, expectedRefusal: expected === "DENY" ? "CAPABILITY_REQUIRED (names the capability)" : "", reach, basis: flat ? (p.capSource.get(pr.cap) ?? []).join("+") : sc ? sc.map((s) => `${s.role}@${s.scopeType}=${s.scopeValue}`).join("+") : "none" });
  }

  // ---------------------------------------------------------------- reconciliation
  const reg = objects.filter((o) => o.registered);
  const reconciliation = {
    registeredNoPageNoApi: reg.filter((o) => !o.hasPage && !o.hasApi).map((o) => o.key),
    registeredNoPage: reg.filter((o) => !o.hasPage).map((o) => o.key),
    registeredNoApi: reg.filter((o) => !o.hasApi).map((o) => o.key),
    registeredNoCapability: reg.filter((o) => o.capabilities.length === 0).map((o) => o.key),
    capabilityObjectsNotRegistered: objects.filter((o) => !o.registered).map((o) => o.key),
    registeredNotInSeed: reg.filter((o) => o.fieldsSeed === null).map((o) => o.key),
    fieldCountDrift: reg.filter((o) => o.fieldsSeed !== null && o.fieldsCensus !== o.fieldsSeed).map((o) => `${o.key}: nonprod ${o.fieldsCensus} vs seed ${o.fieldsSeed}`),
    pagesWithNoRegisteredObject: destinations.filter((d) => d.status === "BUILT" && !d.objects.some((o) => objByKey.has(o))).map((d) => `${d.destination} -> ${d.objects.join("; ") || "(none)"}`),
    builtPagesWithoutGovernedSurface: orphans.map((d) => d.destination),
    placeholderDestinations: destinations.filter((d) => d.status === "PLACEHOLDER").map((d) => d.destination),
    apisWithNoRegisteredObject: Object.entries(operations.filter((o) => !objByKey.has(o.object)).reduce((m, o) => { (m[o.object] ??= []).push(o.op); return m; }, {})).map(([k, v]) => ({ object: k, ops: uniq(v) })),
    capabilitiesHeldByNoRole: C.capabilities.filter((c) => !C.role_capabilities.some((g) => g.cap === c.key)).map((c) => c.key),
    capabilitiesHeldByOnlyAdminOrOwner: C.capabilities.filter((c) => { const h = uniq(C.role_capabilities.filter((g) => g.cap === c.key).map((g) => g.role)); return h.length > 0 && h.every((r) => r === "admin" || r === "owner"); }).length,
  };

  return {
    census: C, snap: SNAP, roles, personas, personaByKey, objects, destinations, operations, surfaces, scopeEval, nav,
    principalsNoRole, personasNoRole, personasZeroCaps, rolesNoAssignee,
    roleCapRows, divergence, credOnly, editWithoutRead, personaCapRows, personaCredRows, wfSeeds, wfActions, bindingCounts, censusBindings, personaWfRows,
    probeRows, probeProblems, reconciliation, impliedKeys, opErrors: opx.errors,
    maps: { roleByKey, capByKey, objByKey, grantsByRole, jobRoleLabel },
  };
}
