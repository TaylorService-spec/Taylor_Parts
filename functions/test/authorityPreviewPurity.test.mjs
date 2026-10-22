// GRANT-IMPACT PREVIEW PURITY GUARD (PR 3; arch/grant-impact-preview.md §1.3(b), corrected per independent review
// finding 11 so it is TRUE ON DAY ONE).
//
// The preview runs the nine UNCHANGED authority commands inside a transaction it always rolls back. That is only a
// faithful, side-effect-free simulation while everything those commands (and the resolver the preview snapshots with)
// can reach does nothing a ROLLBACK cannot undo. This suite pins that reach statically:
//
//   1. the VALUE-import closure of the commands + the engine is PINNED (growth is a reviewed edit here);
//   2. its external imports are exactly node:crypto (randomUUID / sha256), node:async_hooks (the request-scoped session
//      tenant binding of EOS native identity, AsyncLocalStorage only) and pg -- the latter ONLY through the pool
//      factory policyDatabase.ts, which capabilityAuthority reaches for its deployed-pool convenience and which the
//      preview never calls (it is composed with the shared pool and hands the resolver its transaction client);
//   3. over the closure: no Firebase, no network, no fetch, no timers, no console, no process.env, no module-level
//      mutable state, no SQL literal naming NOTIFY / LISTEN / sequences / session advisory locks -- each exception
//      named below with its reason (policyDatabase.ts only);
//   4. the engine itself: ROLLBACK is its only terminal statement, it never reaches for the process pool, and the nine
//      commands take no port beyond (repository, actor, input) -- so there is nothing external to hand them.
//
// The runtime half (spies, statement log, the database fence) is test/authorityPreviewSafetyPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valueImportClosure } from "./support/valueImportClosure.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = ["src/adminPolicy/policyCommands.ts", "src/eosOps/authorityChangePreview.ts", "src/adminPolicy/authorityChangePreviewPort.ts"];
const ENGINE = "src/eosOps/authorityChangePreview.ts";

const PINNED_CLOSURE = [
  "src/access/compatibilityRoles.ts", "src/access/governedBusinessRoles.ts", "src/access/permissionCatalog.ts",
  // DECISIONS #SAE-2: the Owner-only gate of the self-approval exemption family (SAE Rule 2) and the pure rule it shares with the approval seam (no I/O, an immutable symbol brand).
  "src/access/secondaryApprovalExemptionCore.ts",
  "src/adminPolicy/administrationAuthority.ts", "src/adminPolicy/administrationCapabilityGate.ts",
  "src/adminPolicy/administrationSurfaceAuthority.ts", "src/adminPolicy/assignmentScope.ts", "src/adminPolicy/assignmentScopeRuntime.ts",
  "src/adminPolicy/authorityChangePreviewPort.ts", "src/adminPolicy/effectiveObjectAccess.ts", "src/adminPolicy/employmentAccessEligibility.ts", "src/adminPolicy/exemptionAdministration.ts",
  "src/adminPolicy/objectSecurityAuthority.ts", "src/adminPolicy/policyCommands.ts", "src/adminPolicy/policyDatabase.ts",
  "src/adminPolicy/policyRepository.ts", "src/adminPolicy/postgresPolicyRepository.ts", "src/adminPolicy/principalContext.ts",
  "src/adminPolicy/protectedAdministrator.ts", "src/adminPolicy/roleCapabilityAdministration.ts", "src/adminPolicy/types.ts",
  // DECISIONS #248: the pure Role company-authority vocabulary + the finance.* guard (no I/O), imported by policyCommands.
  "src/adminPolicy/roleCompanyAuthorityEffect.ts",
  "src/eosOps/administrationReach.ts", "src/eosOps/authorityChangePreview.ts", "src/eosOps/capabilityAuthority.ts",
  // DECISIONS #249: the preview snapshot reports each member's company authority through the SAME resolver (reads only; type-only pg import).
  "src/eosOps/companyAuthority.ts",
  "src/eosOps/conditionalEntitlement.ts", "src/eosOps/contextualAuthorization.ts", "src/eosOps/entitledActionAuthority.ts",
  "src/eosOps/experienceAuthority.ts", "src/eosOps/governedFieldGroups.ts", "src/eosOps/grantConditionPolicy.ts",
  // PARTS-404 / RO-02: the inventory.reorderQueue door's reorderWarehouseReach dimension reuses the Reorder read reach helper (reads only; type-only pg import).
  "src/eosOps/reorderQueueReach.ts",
  "src/opportunity/opportunityLifecycle.ts",
  // PR 3 follow-up: the SECURITY_ROLE workflow-responsibility dimension -- the SAME derivation the
  // listPrincipalWorkflowResponsibilities transport serves (the runtime explanation x the active workflow definitions).
  "src/adminPolicy/workflowEngine.ts", "src/adminPolicy/workflowResponsibilities.ts", "src/eosOps/effectiveAccessExplanation.ts",
  "src/eosOps/functionalRoleFacts.ts",
  // EOS native identity (D-12): principalContext reads the request's session-tenant binding. Side-effect free: an
  // AsyncLocalStorage of the CURRENT request's scope, keyed to the AUTHENTICATED caller's own identity -- no I/O, no
  // writes, no timers. The preview never resolves through it (it does not call resolvePrincipalContext).
  "src/eosAuth/requestTenantBinding.ts",
];

/** The ONE file allowed each otherwise-forbidden construct, and why. Nothing else may be added without a reason. */
const ALLOWED = Object.freeze({
  "src/adminPolicy/policyDatabase.ts": {
    reason: "the process pool factory: reads DATABASE_URL, owns the one module-level pool, logs idle-client errors and "
      + "retries readiness at STARTUP. Reached only through capabilityAuthority.operationalCapabilityPool; the preview "
      + "receives the shared pool by composition and never calls it (asserted below).",
    constructs: ["timers", "console", "processEnv", "moduleMutable"],
  },
});

/** Module-level collections in the closure: constant lookup tables built once at load. Proved never mutated below. */
const CONSTANT_COLLECTIONS = Object.freeze({
  "src/adminPolicy/assignmentScope.ts": ["VALUE_MATCHED"],
  "src/adminPolicy/protectedAdministrator.ts": ["IMPLIED_ACTION_KINDS", "SYSTEM_ADMINISTRATION_OBJECTS", "PROTECTED_ADMINISTRATOR_EXCLUSIONS",
    "PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES"],
  "src/adminPolicy/roleCapabilityAdministration.ts": ["FORBIDDEN", "RESERVED_CAPABILITY_HOLDERS", "ADMINISTRATION_GRANT_ONLY_CAPABILITIES",
    "CATALOG_DECLARATIONS_WITHOUT_SYSTEM_DEFAULT",
    // #232 Option C: the two role-assignment-only Financial Policy keys -- a constant lookup table, never mutated.
    "ROLE_ASSIGNMENT_ONLY_CAPABILITIES"],
  "src/eosOps/administrationReach.ts": ["ADMINISTRATION_REACH_SCOPE_TYPES", "ADMINISTRATION_REACH_CAPABILITIES", "ADMINISTRATOR_EXECUTION_CAPABILITIES"],
  "src/eosOps/contextualAuthorization.ts": ["GOVERNED_QUALIFICATION_CODES"],
  // The method names the per-snapshot memoizing reader answers once; the CACHE itself lives in the snapshot, not here.
  "src/eosOps/authorityChangePreview.ts": ["MEMOIZED_READS"],
});

const code = (file) => readFileSync(resolve(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const stringLiterals = (source) => source.match(/`[^`]*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) ?? [];

const CONSTRUCTS = {
  fetch: /\bfetch\s*\(/,
  timers: /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(|process\.nextTick/,
  console: /\bconsole\./,
  processEnv: /process\.env/,
  moduleMutable: /^(?:export\s+)?(?:let|var)\s/m,
  firebase: /from\s+["'](?:firebase|firebase-admin|firebase-functions)[^"']*["']/,
};

const closure = valueImportClosure(ROOT, ENTRIES);

test("1. the value-import closure of the nine commands + the preview engine is pinned", () => {
  assert.deepEqual(closure.files, [...PINNED_CLOSURE].sort(),
    "the closure changed: re-run the side-effect census (arch/grant-impact-preview.md §1) and update the pin with the reason");
});

test("2. external imports are exactly node:crypto, node:async_hooks and pg (pg only through the pool factory)", () => {
  assert.deepEqual(Object.fromEntries([...closure.external.entries()].sort()), {
    // AsyncLocalStorage only (requestTenantBinding.ts, EOS native identity D-12): request-scoped state, nothing a
    // ROLLBACK would have to undo.
    "node:async_hooks": ["src/eosAuth/requestTenantBinding.ts"],
    "node:crypto": ["src/adminPolicy/postgresPolicyRepository.ts", "src/eosOps/authorityChangePreview.ts"],
    pg: ["src/adminPolicy/policyDatabase.ts"],
  });
});

test("3. nothing in the closure reaches outside the transaction (named exceptions only)", () => {
  const offences = [];
  for (const file of closure.files) {
    const source = code(file);
    const allowed = new Set(ALLOWED[file]?.constructs ?? []);
    for (const [name, pattern] of Object.entries(CONSTRUCTS)) {
      if (pattern.test(source) && !allowed.has(name)) offences.push(`${file}: ${name}`);
    }
    for (const literal of stringLiterals(source)) {
      if (/\bNOTIFY\b|\bLISTEN\b|pg_notify|dblink|\bnextval\b|\bsetval\b|pg_advisory_(?:un)?lock(?:_shared)?\s*\(|COPY\s.*PROGRAM/i.test(literal)) {
        offences.push(`${file}: SQL literal ${literal.slice(0, 80)}`);
      }
    }
    const collections = source.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)[^=\n]*=\s*(?:Object\.freeze\()?new\s+(?:Map|Set|WeakMap|WeakSet)\b/gm) ?? [];
    for (const decl of collections) {
      const name = decl.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)/)[1];
      if (!(CONSTANT_COLLECTIONS[file] ?? []).includes(name)) offences.push(`${file}: module-level collection ${name}`);
      if (new RegExp(`\\b${name}\\s*\\.\\s*(?:add|set|delete|clear)\\s*\\(`).test(source)) offences.push(`${file}: ${name} is mutated`);
    }
  }
  assert.deepEqual(offences, [], "a module the simulated commands can reach has an effect ROLLBACK cannot undo");
  for (const file of Object.keys(ALLOWED)) assert.ok(closure.files.includes(file), `${file} is allow-listed but no longer in the closure`);
  for (const [file, names] of Object.entries(CONSTANT_COLLECTIONS)) {
    for (const name of names) assert.match(code(file), new RegExp(`(?:const|let|var)\\s+${name}\\b`), `${file}: ${name} no longer exists -- shrink the pin`);
  }
});

test("4. the engine: ROLLBACK is its only terminal statement; it never reaches for the process pool", () => {
  const engine = code(ENGINE);
  assert.equal(/\b(?:query|engine)\(\s*["'`]\s*(?:COMMIT|END|PREPARE)\b/i.test(engine), false, "the engine issues a COMMIT");
  // The final ROLLBACK is budget-EXEMPT: undoing is never refused for lack of time.
  assert.match(engine, /simulation\.engine\("ROLLBACK", \[\], true\)/);
  assert.equal(/getPolicyDatabasePool|operationalCapabilityPool/.test(engine), false, "the engine must be handed its pool, never fetch one");
  assert.equal(/SET CONSTRAINTS ALL/i.test(engine), false, "SET CONSTRAINTS ALL would arm the never-commit fence");
  // The simulated commit point names only the catalog's NON-fence deferrable constraints.
  assert.match(engine, /c\.conname <> 'preview_never_commits'/);
});

test("4. the nine commands take no port beyond (repository, actor, input): there is nothing external to hand them", () => {
  const commands = readFileSync(resolve(ROOT, "src/adminPolicy/policyCommands.ts"), "utf8");
  for (const name of ["grantObjectActionToRole", "revokeObjectActionFromRole", "applyObjectWideRoleAuthority", "setGrantCondition",
    "retireGrantCondition", "grantObjectActionToPrincipal", "revokeObjectActionFromPrincipal", "assignRole", "revokeRole",
    "grantCompanyAuthority", "revokeCompanyAuthority"]) {
    const m = commands.match(new RegExp(`export async function ${name}\\(([\\s\\S]*?)\\):`));
    assert.ok(m, `${name} not found`);
    const params = m[1].split(/,(?![^{]*})/).map((p) => p.trim()).filter(Boolean).map((p) => p.split(":")[0].trim());
    assert.deepEqual(params, ["repo", "actor", "input"], `${name} gained a parameter -- a port the preview must fence`);
  }
});
