#!/usr/bin/env node
// VENTANA UAT FIXTURE -- ordered, idempotent, NONPROD-ONLY operator script (the controller runs it; Claude and Codex do not).
//
// What it does: calls the EXISTING governed commands (Administration createWarehouse, Workforce createEmployee, Administration
// grantCompanyAuthority, then the Commercial / CRM / Work Order chain) as named nonprod personas, through the EOS API. It writes nothing
// directly to a database and creates no credential, account, enrollment or grant that the Owner has not named.
//
// SAFETY (all enforced before any request is sent):
//   - DRY RUN by default. Writing needs --apply.
//   - The target is checked here by EXACT match against config/environments.json (platform-sandbox, role != production, eosApi.baseUrl). An
//     EOS_API_BASE_URL that differs is REFUSED; the base URL is then passed explicitly to the harness. (Independent of #2201; do not run before #2201 is merged.)
//   - Every record carries the marker "SYNTHETIC UAT" and an id/key prefixed "ventana-uat-"; every company is "ventana". A step that could name
//     anything else is refused at load time. Taylor data is never read or written.
//   - UNVERIFIED steps (verified:false) are listed but NOT executed unless --include-unverified; the controller confirms their payloads first.
//   - A company-access grant is written only for employee ids named with --grant (Owner decision OQ-08). Default: none.
//   - The persona issuer is used as an API client for governed commands. It is NOT login proof and no password or MFA secret is read here.
//   - Output is one JSON line per step: step, outcome, code. No token, credential, header or request body is ever printed.
//
// Usage (from the repository root, after the Ventana key is bound; see spec prerequisite P1):
//   node docs/uat/tools/ventana-uat-fixture.mjs                       # dry run: prints the ordered plan
//   EOS_PERSONA_ISSUER_CREDENTIAL=<set by the operator> node docs/uat/tools/ventana-uat-fixture.mjs --apply [--grant <employeeId,...>] [--include-unverified] [--only S20,S21]
// Exit: 0 = every selected step PLANNED / APPLIED / PRESENT; 2 = refused, blocked or unsafe.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, "ventana-uat-fixture.spec.json"), "utf8"));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const val = (n) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag("apply");
const INCLUDE_UNVERIFIED = flag("include-unverified");
const ONLY = val("only") ? new Set(val("only").split(",")) : null;
const GRANTS = val("grant") ? val("grant").split(",").map((s) => s.trim()).filter(Boolean) : [];

const out = (o) => console.log(JSON.stringify(o));
const stop = (code, message) => { out({ outcome: "STOPPED", code, message }); process.exit(2); };

// ---------------------------------------------------------------- target fence (exact match; production refused)
const registry = JSON.parse(fs.readFileSync(path.join(REPO, "config", "environments.json"), "utf8"));
const env = (registry.environments ?? []).find((e) => e.id === "platform-sandbox");
if (!env || env.role === "production" || !env.eosApi?.baseUrl) stop("TARGET_NOT_REGISTERED_NONPROD", "platform-sandbox is not a registered nonprod environment with an EOS API");
const BASE = String(env.eosApi.baseUrl).replace(/\/+$/, "");
const override = process.env.EOS_API_BASE_URL ? String(process.env.EOS_API_BASE_URL).replace(/\/+$/, "") : null;
if (override !== null && override !== BASE) stop("TARGET_OVERRIDE_REFUSED", "EOS_API_BASE_URL differs from the registered nonprod API; unset it");
if (!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(BASE) || /taylor-parts/.test(BASE)) stop("TARGET_SHAPE_REFUSED", "the registered API URL is not a nonprod Render host");

// ---------------------------------------------------------------- spec fence (synthetic marker, ventana only, prefixed ids)
const walk = (v, fn) => { if (v && typeof v === "object") { fn(v); for (const x of Object.values(v)) walk(x, fn); } };
const plan = [];
for (const s of SPEC.steps) {
  if (ONLY && !ONLY.has(s.id)) continue;
  const inputs = s.perGrant ? GRANTS.map((e) => ({ ...s, id: `${s.id}:${e}`, input: { ...s.inputTemplate, employeeId: e } })) : [s];
  for (const st of inputs) {
    if (!st.input) continue;
    // The marker must be on every free-text field the command accepts (name, siteLabel, displayName, reason); a step with none must be titled SYNTHETIC.
    let texts = 0;
    walk(st.input, (o) => { for (const k of ["name", "siteLabel", "displayName", "reason"]) if (typeof o[k] === "string") { texts += 1; if (!o[k].includes(SPEC.marker)) stop("MARKER_MISSING", `step ${st.id} field ${k} does not carry the marker "${SPEC.marker}"`); } });
    if (texts === 0 && !/SYNTHETIC/.test(st.title)) stop("MARKER_MISSING", `step ${st.id} has no marked field and is not titled SYNTHETIC`);
    walk(st.input, (o) => {
      if (typeof o.operatingCompanyId === "string" && o.operatingCompanyId !== SPEC.company) stop("COMPANY_NOT_VENTANA", `step ${st.id} names company ${o.operatingCompanyId}`);
      for (const k of ["warehouseId", "employeeId"]) if (typeof o[k] === "string" && !st.perGrant && !o[k].startsWith(SPEC.idPrefix)) stop("ID_NOT_PREFIXED", `step ${st.id} ${k} is not prefixed ${SPEC.idPrefix}`);
    });
    if (st.perGrant && !/^(ventana-uat-|synthetic-np-emp-)/.test(st.input.employeeId)) stop("GRANT_TARGET_REFUSED", `--grant ${st.input.employeeId} is not a synthetic nonprod employee id`);
    plan.push(st);
  }
}
if (plan.length === 0) stop("EMPTY_PLAN", "no step selected");

// ---------------------------------------------------------------- dry run
if (!APPLY) {
  out({ mode: "DRY_RUN", target: BASE, note: "nothing is sent; --apply writes. The Ventana key must already be bound (spec P1)." });
  for (const s of plan) out({ step: s.id, outcome: s.verified || INCLUDE_UNVERIFIED ? "PLANNED" : "SKIPPED_UNVERIFIED", persona: s.persona, route: s.route, operation: s.operation, governedPath: s.governedPath, confirm: s.confirm ?? undefined });
  process.exit(0);
}

// ---------------------------------------------------------------- apply
if (!process.env.EOS_PERSONA_ISSUER_CREDENTIAL) stop("NO_ISSUER_CREDENTIAL", "EOS_PERSONA_ISSUER_CREDENTIAL is not set (the operator sets it; this script never discovers it)");
const { callEosApiAsPersona } = await import(pathToFileURL(path.join(REPO, "scripts", "eosPersonaSession.mjs")).href);
const results = new Map();
const resolveRefs = (v) => {
  if (Array.isArray(v)) return v.map(resolveRefs);
  if (v && typeof v === "object") {
    if (typeof v.$ref === "string") { const [stepId, field] = v.$ref.split("."); const r = results.get(stepId); const found = r?.[field]; if (found === undefined) stop("REF_UNRESOLVED", `${v.$ref} has no value; the earlier step did not return it`); return found; }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x)]));
  }
  return v;
};
let failed = false;
for (const s of plan) {
  if (!s.verified && !INCLUDE_UNVERIFIED) { out({ step: s.id, outcome: "SKIPPED_UNVERIFIED", confirm: s.confirm }); continue; }
  if (s.requiresOwnerAccessActs && !s.verified) { out({ step: s.id, outcome: "SKIPPED_NEEDS_OWNER_ACCESS_ACTS", needs: s.requiresOwnerAccessActs }); continue; }
  let res;
  try {
    res = await callEosApiAsPersona(s.persona, s.route, { operation: s.operation, input: resolveRefs(s.input) }, { baseUrl: BASE });
  } catch (e) { out({ step: s.id, outcome: "ERROR", code: e?.code ?? "TRANSPORT" }); failed = true; break; }
  const body = res.body ?? {};
  const payload = body.data ?? body.result ?? {};
  if (body.ok === true) {
    results.set(s.id.split(":")[0], payload);
    out({ step: s.id, outcome: "APPLIED", status: res.status });
    continue;
  }
  const code = body.code ?? `HTTP_${res.status}`;
  if ((s.presentCodes ?? []).includes(code)) { out({ step: s.id, outcome: "PRESENT", code }); continue; }
  if ((s.keyUnboundCodes ?? []).includes(code)) { out({ step: s.id, outcome: "STOPPED_KEY_NOT_BOUND", code, message: "bind the Ventana operating-company key first (spec prerequisite P1)" }); failed = true; break; }
  out({ step: s.id, outcome: "REFUSED", code, status: res.status }); failed = true; break; // ordered dependencies: stop on the first refusal
}
process.exit(failed ? 2 : 0);
