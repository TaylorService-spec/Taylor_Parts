#!/usr/bin/env node
// VENTANA UAT FIXTURE -- ordered, idempotent, NONPROD-ONLY operator script (the controller runs it; Claude and Codex do not).
//
// What it does: calls the EXISTING governed commands (Administration createWarehouse and grantCompanyAuthority, Workforce createEmployee,
// CRM createAccount / createAccountLocation, the Commercial chain, Work Order createWorkOrder) as named nonprod personas, through the EOS API.
// It writes nothing directly to a database and creates no credential, account, enrollment or grant that the Owner has not approved by digest.
//
// SAFETY (all enforced before any request is sent):
//   - DRY RUN by default: OFFLINE, sends nothing, needs no credential. Writing needs --apply.
//   - The target is checked by EXACT match against config/environments.json (platform-sandbox, role != production, eosApi.baseUrl). An
//     EOS_API_BASE_URL that differs is REFUSED; the registered base URL is then passed explicitly to the harness.
//   - Every record carries the marker "SYNTHETIC UAT" and an id/key prefixed "ventana-uat-"; every company is "ventana". A step that could
//     name anything else is refused at load time. Taylor data is never read or written.
//   - THE VENTANA KEY: binding it is a separate human-authorized procedure that this script never performs. If it is not bound, the first
//     write refuses OPERATING_COMPANY_NOT_GOVERNED and the script stops with STOPPED_KEY_NOT_BOUND: the fixture waits for the key.
//   - COMPANY-ACCESS GRANTS: only the Employees in the spec's grantAllowlist can ever be named; the Taylor-only negative controls
//     (neverGrant) are refused outright. Every grant is PREVIEWED first (previewAuthorityChange, advisory and read-only). The preview outcome
//     and digest are printed. A grant is COMMITTED only with an explicit --grant <id> AND --approve-digest <id>=<digest> that equals the
//     digest the preview just returned. No grant is ever written without a preview and an approval.
//   - PROTECTED RECEIVABLES: the three existing Ventana obligations are read (read-only listObligations as financeAccounting) before and after
//     every apply; the count must equal protectedObligations.expectedCount and a hash of their stable fields must not change, else STOPPED.
//   - The persona issuer is used as an API client for governed commands. It is NOT login proof and no password or MFA secret is read here.
//   - Output is one JSON line per step: step, outcome, code. No token, credential, header or request body is ever printed.
//
// Usage (from the repository root):
//   node docs/uat/tools/ventana-uat-fixture.mjs                                     # dry run: OFFLINE plan, grant list, protected-receivable check plan
//   EOS_PERSONA_ISSUER_CREDENTIAL=<set by the operator> node docs/uat/tools/ventana-uat-fixture.mjs --preview [--grant <id,...>]
//                                                                                   # READ-ONLY: protected receivables snapshot + grant previews (outcome, digest); writes nothing
//   EOS_PERSONA_ISSUER_CREDENTIAL=<set by the operator> node docs/uat/tools/ventana-uat-fixture.mjs --apply [--grant <id,...>] [--approve-digest <id>=<digest>,...]
//                                                                                   # [--only S20,S21] [--include-reconfirm] [--include-unverified]
// Exit: 0 = every selected step PLANNED / APPLIED / PRESENT / AWAITING_APPROVAL; 2 = refused, blocked, changed protected rows or unsafe.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, "ventana-uat-fixture.spec.json"), "utf8"));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const val = (n) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag("apply");
const PREVIEW = flag("preview");
const INCLUDE_UNVERIFIED = flag("include-unverified");
const INCLUDE_RECONFIRM = flag("include-reconfirm");
const ONLY = val("only") ? new Set(val("only").split(",")) : null;
const GRANTS = val("grant") ? val("grant").split(",").map((s) => s.trim()).filter(Boolean) : [];

const out = (o) => console.log(JSON.stringify(o));
const stop = (code, message) => { out({ outcome: "STOPPED", code, message }); process.exit(2); };
if (APPLY && PREVIEW) stop("MODE_CONFLICT", "--apply and --preview are exclusive");

// ---------------------------------------------------------------- approvals (--approve-digest <id>=<digest>,...)
const DIGEST = /^[0-9a-f]{64}$/;
const APPROVED = new Map();
for (const tok of (val("approve-digest") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const eq = tok.indexOf("=");
  const id = eq >= 0 ? tok.slice(0, eq) : (GRANTS.length === 1 ? GRANTS[0] : null);
  const digest = eq >= 0 ? tok.slice(eq + 1) : tok;
  if (!id || !DIGEST.test(digest)) stop("APPROVE_DIGEST_INVALID", "--approve-digest takes <employeeId>=<64-hex digest> (a bare digest only with exactly one --grant)");
  if (!GRANTS.includes(id)) stop("APPROVE_DIGEST_WITHOUT_GRANT", `--approve-digest names ${id}, which is not named with --grant`);
  APPROVED.set(id, digest);
}

// ---------------------------------------------------------------- grant fence (allowlist + negative controls)
const ALLOW = SPEC.grantAllowlist ?? {};
const NEVER = SPEC.neverGrant ?? {};
for (const g of GRANTS) {
  if (Object.prototype.hasOwnProperty.call(NEVER, g)) stop("GRANT_TARGET_NEGATIVE_CONTROL", `${g} is a Taylor-only negative control and must never be granted Ventana access`);
  if (!Object.prototype.hasOwnProperty.call(ALLOW, g)) stop("GRANT_TARGET_NOT_ALLOWLISTED", `${g} is not in the spec grantAllowlist (${Object.keys(ALLOW).join(", ")})`);
}

// ---------------------------------------------------------------- target fence (exact match; production refused)
const registry = JSON.parse(fs.readFileSync(path.join(REPO, "config", "environments.json"), "utf8"));
const env = (registry.environments ?? []).find((e) => e.id === "platform-sandbox");
if (!env || env.role === "production" || !env.eosApi?.baseUrl) stop("TARGET_NOT_REGISTERED_NONPROD", "platform-sandbox is not a registered nonprod environment with an EOS API");
const BASE = String(env.eosApi.baseUrl).replace(/\/+$/, "");
const override = process.env.EOS_API_BASE_URL ? String(process.env.EOS_API_BASE_URL).replace(/\/+$/, "") : null;
if (override !== null && override !== BASE) stop("TARGET_OVERRIDE_REFUSED", "EOS_API_BASE_URL differs from the registered nonprod API; unset it");
if (!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(BASE) || /taylor-parts/.test(BASE)) stop("TARGET_SHAPE_REFUSED", "the registered API URL is not a nonprod Render host");

// ---------------------------------------------------------------- spec fence (synthetic marker, ventana only, prefixed ids)
const MARKED_FIELDS = ["name", "siteLabel", "displayName", "reason", "need", "complaint"];
const walk = (v, fn) => { if (v && typeof v === "object") { fn(v); for (const x of Object.values(v)) walk(x, fn); } };
const plan = [];
for (const s of SPEC.steps) {
  if (ONLY && !ONLY.has(s.id)) continue;
  const inputs = s.perGrant ? GRANTS.map((e) => ({ ...s, id: `${s.id}:${e}`, input: { ...s.inputTemplate, employeeId: e } })) : [s];
  for (const st of inputs) {
    if (!st.input) continue;
    let texts = 0;
    walk(st.input, (o) => { for (const k of MARKED_FIELDS) if (typeof o[k] === "string") { texts += 1; if (!o[k].includes(SPEC.marker)) stop("MARKER_MISSING", `step ${st.id} field ${k} does not carry the marker "${SPEC.marker}"`); } });
    if (texts === 0 && !/SYNTHETIC/.test(st.title)) stop("MARKER_MISSING", `step ${st.id} has no marked field and is not titled SYNTHETIC`);
    walk(st.input, (o) => {
      if (typeof o.operatingCompanyId === "string" && o.operatingCompanyId !== SPEC.company) stop("COMPANY_NOT_VENTANA", `step ${st.id} names company ${o.operatingCompanyId}`);
      for (const k of ["warehouseId", "employeeId"]) if (typeof o[k] === "string" && !st.perGrant && !o[k].startsWith(SPEC.idPrefix)) stop("ID_NOT_PREFIXED", `step ${st.id} ${k} is not prefixed ${SPEC.idPrefix}`);
    });
    plan.push(st);
  }
}
if (plan.length === 0 && !PREVIEW) stop("EMPTY_PLAN", "no step selected");

const PO = SPEC.protectedObligations;
const stateOf = (s) => (s.planOnly ? "PLAN_ONLY" : s.reconfirmAfter && !INCLUDE_RECONFIRM ? `SKIPPED_RECONFIRM_AFTER_${s.reconfirmAfter}` : !s.verified && !INCLUDE_UNVERIFIED ? "SKIPPED_UNVERIFIED" : "PLANNED");

// ---------------------------------------------------------------- dry run (OFFLINE)
if (!APPLY && !PREVIEW) {
  out({ mode: "DRY_RUN", target: BASE, offline: true, note: "nothing is sent and no credential is read; --preview reads, --apply writes. The Ventana key must already be bound by the separate human-authorized procedure (spec P1); otherwise the first write stops with STOPPED_KEY_NOT_BOUND." });
  out({ protectedReceivables: { company: PO.operatingCompanyId, expectedCount: PO.expectedCount, check: `read-only ${PO.operation} as ${PO.persona} before and after --apply (and with --preview); STOPPED if the count differs or the hash of ${PO.stableFields.join(",")} changes`, status: "PLANNED_NOT_RUN_OFFLINE" } });
  out({ grants: { proposed: Object.fromEntries(Object.entries(ALLOW).map(([id, v]) => [id, v.persona])), financeReuse: SPEC.financeReuse, neverGrant: Object.fromEntries(Object.entries(NEVER).map(([id, v]) => [id, v])), selected: GRANTS, commit: "only with --grant <id> AND --approve-digest <id>=<digest> equal to the preview digest" } });
  for (const s of plan) out({ step: s.id, outcome: stateOf(s), persona: s.persona, route: s.route, operation: s.operation, governedPath: s.governedPath, reconfirmAfter: s.reconfirmAfter ?? undefined });
  process.exit(0);
}

// ---------------------------------------------------------------- shared (--preview and --apply need the harness and a credential)
if (!process.env.EOS_PERSONA_ISSUER_CREDENTIAL) stop("NO_ISSUER_CREDENTIAL", "EOS_PERSONA_ISSUER_CREDENTIAL is not set (the operator sets it; this script never discovers it)");
const { callEosApiAsPersona } = await import(pathToFileURL(path.join(REPO, "scripts", "eosPersonaSession.mjs")).href);
const call = (persona, route, payload) => callEosApiAsPersona(persona, route, payload, { baseUrl: BASE });

// PROTECTED RECEIVABLES: read-only. Never a write, never a re-key.
async function protectedSnapshot() {
  let res;
  try { res = await call(PO.persona, PO.route, { operation: PO.operation, input: PO.input }); } catch (e) { return stop("PROTECTED_READ_FAILED", e?.code ?? "TRANSPORT"); }
  const b = res.body ?? {};
  if (b.ok !== true) return stop("PROTECTED_READ_REFUSED", b.code ?? `HTTP_${res.status}`);
  const items = b.result?.items ?? b.data?.items;
  if (!Array.isArray(items)) return stop("PROTECTED_READ_SHAPE", "listObligations returned no items array");
  if (items.length >= 200) return stop("PROTECTED_READ_TRUNCATED", "the list is at its 200-row cap; the protected set cannot be proven");
  const rows = items.filter((i) => i.operatingCompanyId === PO.operatingCompanyId)
    .map((i) => Object.fromEntries(PO.stableFields.map((f) => [f, i[f] ?? null]))).sort((a, c) => String(a.id).localeCompare(String(c.id)));
  return { count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}
// GRANT PREVIEW: previewAuthorityChange is advisory and read-only.
const grantStep = SPEC.steps.find((s) => s.id === "S40");
async function previewGrant(employeeId) {
  const input = { ...grantStep.inputTemplate, employeeId };
  let res;
  try { res = await call(grantStep.persona, grantStep.route, { operation: "previewAuthorityChange", input: { change: { operation: "grantCompanyAuthority", input } } }); } catch (e) { return { input, error: e?.code ?? "TRANSPORT" }; }
  const b = res.body ?? {};
  if (b.ok !== true) return { input, error: b.code ?? `HTTP_${res.status}` };
  const d = b.data ?? b.result ?? {};
  return { input, outcome: d.outcome ?? null, refusal: d.refusal?.code ?? null, digest: d.digests?.previewDigest ?? null };
}

const before = await protectedSnapshot();
out({ protectedReceivables: "BEFORE", company: PO.operatingCompanyId, count: before.count, hash: before.hash });
if (before.count !== PO.expectedCount) stop("PROTECTED_OBLIGATIONS_COUNT_UNEXPECTED", `expected ${PO.expectedCount} Ventana obligations, read ${before.count}; nothing was written`);

// ---------------------------------------------------------------- preview (READ-ONLY)
if (PREVIEW) {
  for (const g of GRANTS) {
    const p = await previewGrant(g);
    out({ step: `S40:${g}`, persona: ALLOW[g].persona, outcome: p.error ? "PREVIEW_ERROR" : p.outcome, refusal: p.refusal ?? undefined, code: p.error ?? undefined, previewDigest: p.digest ?? undefined,
      next: p.outcome === "WOULD_APPLY" ? `commit only with --apply --grant ${g} --approve-digest ${g}=<this digest>` : undefined });
  }
  process.exit(0);
}

// ---------------------------------------------------------------- apply
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
  const st = stateOf(s);
  if (st !== "PLANNED") { out({ step: s.id, outcome: st, traced: s.traced ? undefined : s.confirm, needs: s.requiresOwnerAccessActs }); continue; }

  if (s.previewFirst) {
    const g = s.input.employeeId;
    const p = await previewGrant(g);
    if (p.error) { out({ step: s.id, outcome: "PREVIEW_ERROR", code: p.error }); failed = true; break; }
    out({ step: s.id, outcome: "PREVIEWED", previewOutcome: p.outcome, refusal: p.refusal ?? undefined, previewDigest: p.digest ?? undefined });
    if (p.outcome === "NO_OP") { out({ step: s.id, outcome: "PRESENT", code: "NO_OP" }); continue; }
    if (p.outcome !== "WOULD_APPLY" || !p.digest) { out({ step: s.id, outcome: "REFUSED", code: p.refusal ?? p.outcome ?? "PREVIEW_NOT_APPLICABLE" }); failed = true; break; }
    const approved = APPROVED.get(g);
    if (!approved) { out({ step: s.id, outcome: "AWAITING_APPROVAL", previewDigest: p.digest, next: `re-run with --grant ${g} --approve-digest ${g}=${p.digest} once the Owner approves` }); continue; }
    if (approved !== p.digest) { out({ step: s.id, outcome: "STOPPED", code: "GRANT_DIGEST_MISMATCH", message: "the approved digest is not the current preview digest; nothing was written" }); failed = true; break; }
    let res;
    try { res = await call(s.persona, s.route, { operation: s.operation, input: { ...s.input, previewDigest: p.digest } }); } catch (e) { out({ step: s.id, outcome: "ERROR", code: e?.code ?? "TRANSPORT" }); failed = true; break; }
    const body = res.body ?? {};
    if (body.ok === true) { out({ step: s.id, outcome: "APPLIED", status: res.status }); continue; }
    out({ step: s.id, outcome: "REFUSED", code: body.code ?? `HTTP_${res.status}`, status: res.status }); failed = true; break;
  }

  let res;
  try {
    res = await call(s.persona, s.route, { operation: s.operation, input: resolveRefs(s.input) });
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
  if ((s.keyUnboundCodes ?? []).includes(code)) { out({ step: s.id, outcome: "STOPPED_KEY_NOT_BOUND", code, message: "the Ventana operating-company key is not bound; the fixture waits for the separate human-authorized key procedure (spec P1)" }); failed = true; break; }
  out({ step: s.id, outcome: "REFUSED", code, status: res.status }); failed = true; break; // ordered dependencies: stop on the first refusal
}

// PROTECTED RECEIVABLES: unchanged, whether or not the run stopped early.
const after = await protectedSnapshot();
out({ protectedReceivables: "AFTER", company: PO.operatingCompanyId, count: after.count, hash: after.hash, unchanged: after.count === before.count && after.hash === before.hash });
if (after.count !== before.count || after.hash !== before.hash) stop("PROTECTED_OBLIGATIONS_CHANGED", "the existing Ventana receivables differ from the pre-flight read; investigate before any further run");
process.exit(failed ? 2 : 0);
