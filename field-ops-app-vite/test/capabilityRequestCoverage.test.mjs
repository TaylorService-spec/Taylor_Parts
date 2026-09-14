// THE RATCHET FOR THE THIRD CAPABILITY FAILURE MODE (P2-G).
//
// ═════════════════════════════ WHAT IS BEING PREVENTED ═════════════════════════════
//
// Three distinct ways a capability can fail to authorize a control:
//
//   1. INACTIVE      — `active: false` in permissionCatalog.ts; the resolver DENIES everywhere.
//   2. NOT ACTIVATED — active in the catalog, not activated for this environment
//                      (capabilityActivationOverrides / config/environments.json).
//   3. UNASKED       — registered, activatable AND granted, and the control is STILL permanently
//                      dead, because the client's request set never asks the server about the id.
//                      `buildHasCapability` requires `feed.decisions[id] === true`; an id nobody
//                      requested has no entry, `undefined !== true`, so the gate is `false` for
//                      every principal in every environment. Granting does not fix it. Activating
//                      does not fix it. Nothing in the server logs records it.
//
// Modes 1 and 2 are DECISIONS and are tested elsewhere. This file tests mode 3 only, and it exists
// because mode 3 has now been introduced, found and hand-patched six times in this codebase:
// My Dashboard's module ids, Data Import's two ids, Administration > Users' six, Inbound Work and
// Email Connections' two, then (P3-A2) inventory.location.bin.manage and inventory.stock.relocate,
// then (P2-G's census) financialPolicy.profile.read / .configure and equipment.compatibility.view.
// Every one of those patches was correct and none of them stopped the next, because nothing FAILED
// when a gate was added without its id. This does.
//
// ═════════════════════════════ HOW ═════════════════════════════
//
// Two complementary checks:
//
//   A. STRUCTURAL. REPORT_CAPABILITY_REQUEST is the de-duplicated union of the declared shell gates
//      (access/shellCapabilityGates.js), and every declared gate id is in it. This is nearly
//      tautological BY CONSTRUCTION now, which is the point — it pins the construction so a future
//      edit cannot quietly go back to a hand-maintained list.
//
//   B. TEXTUAL. Every catalogued capability id that appears as a STRING LITERAL in executable code
//      under src/ must be in the union of the app's declared request sets — unless its site is in
//      the explicit non-gate allowlist below, with a reason. This is what catches the real-world
//      case: somebody types "some.capability.id" at a new gate instead of importing a declaration.
//      A new (file, id) pair fails until it is either requested or justified here by name.
//
// WHY NOT .test.jsx: this is a pure static + module check with no DOM, and the repo's node suites
// are what `npm test` runs. (.test.jsx files cannot run under `node --test` at all — the loader
// rejects the extension with ERR_UNKNOWN_FILE_EXTENSION; they run under `npm run test:components`,
// i.e. vitest. This file is registered in test/suites.json with the `node --test` runner.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPORT_CAPABILITY_REQUEST } from "../src/access/reportCapabilityAccess.js";
import {
  SHELL_CAPABILITY_GATES,
  SHELL_GATED_CAPABILITY_IDS,
  WAREHOUSE_RACKING_GATE,
  FINANCIAL_POLICY_GATE,
  EQUIPMENT_COMPATIBILITY_GATE,
} from "../src/access/shellCapabilityGates.js";
import { SCAN_WORKFLOW_CAPABILITY_IDS, STOCK_RELOCATE_CAPABILITY } from "../src/access/scanWorkflows.js";
import { VIEW_CAPABILITY as EQUIPMENT_COMPATIBILITY_VIEW } from "../src/domain/equipmentCompatibilitySection.js";
import { OPPORTUNITY_CAPABILITY_REQUEST } from "../src/access/opportunityCapabilityAccess.js";
import { SALES_ORDER_CAPABILITY_REQUEST } from "../src/access/salesOrderCapabilityAccess.js";
import { SALES_AGREEMENT_CAPABILITY_REQUEST } from "../src/access/salesAgreementCapabilityAccess.js";
import { INBOUND_WORK_CAPABILITY_REQUEST, EMAIL_INTAKE_CAPABILITY_REQUEST } from "../src/access/inboundWorkSource.js";
import { EQUIPMENT_INSTALL_CAPABILITY_REQUEST } from "../src/access/equipmentInstallCapabilityAccess.js";
import { SERIALIZED_ASSET_ACQUIRE_CAPABILITY_REQUEST } from "../src/access/serializedAssetAcquireCapabilityAccess.js";
import { WORK_ORDER_PARTS_PLAN_CAPABILITY_REQUEST } from "../src/access/workOrderPartsPlanCapabilityAccess.js";
import { declaredPageCapabilities } from "../src/metadata/pageRuntime.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");

// Every request set the app actually sends. A gate id must be in ONE of these to be answerable.
// (Each surface resolves its own set against its own accessVersion; see each module's header.)
const ALL_REQUEST_SETS = {
  REPORT_CAPABILITY_REQUEST,
  OPPORTUNITY_CAPABILITY_REQUEST,
  SALES_ORDER_CAPABILITY_REQUEST,
  SALES_AGREEMENT_CAPABILITY_REQUEST,
  INBOUND_WORK_CAPABILITY_REQUEST,
  EMAIL_INTAKE_CAPABILITY_REQUEST,
  EQUIPMENT_INSTALL_CAPABILITY_REQUEST,
  SERIALIZED_ASSET_ACQUIRE_CAPABILITY_REQUEST,
  WORK_ORDER_PARTS_PLAN_CAPABILITY_REQUEST,
  ACCOUNT_PAGE_CAPABILITY_REQUEST: declaredPageCapabilities(accountRecordPage),
};
const ASKED = new Set(Object.values(ALL_REQUEST_SETS).flat());

// ─────────────────────────── the catalogue ───────────────────────────
// Parsed textually rather than imported: permissionCatalog.ts is TypeScript, which this node-tested
// access layer cannot import without a build step (the same reason reportAccess.js lists its ids).
function catalogueIds() {
  const text = readFileSync(path.join(SRC, "access/permissionCatalog.ts"), "utf8");
  const ids = [...text.matchAll(/\n\s*id:\s*"([^"]+)",/g)].map((m) => m[1]);
  return new Set(ids);
}

// ─────────────────────────── the source sweep ───────────────────────────
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Files that DEFINE or MIRROR the catalogue rather than gating on it. Their ids are the subject
// matter, not a question being asked of the feed.
const CATALOGUE_FILES = new Set([
  "access/permissionCatalog.ts",          // the catalogue itself
  "access/governedBusinessRoles.ts",      // Role -> permission grants
  "access/compatibilityRoles.ts",         // legacy Role -> permission grants
  "access/parityFixtures.ts",             // parity fixtures over both of the above
  "access/legacyAuthorizationSurface.ts", // the legacy surface being compared against
  "access/shadowParityHarness.ts",
  "access/resolveEffectivePermission.ts", // the resolver
  "access/bindingScopePolicy.ts",
  "access/compactClaims.ts",
]);

// NON-GATE literal sites, allowlisted by (file, id) pair with a reason. A pair not listed here and
// not in a request set FAILS. Broadening this list is a deliberate act with a name attached.
//
// The reasons, once, because they are the same three:
//   (a) PERMISSION-MATRIX DATA — objectPermissionMap.js / policyObjectRegistry.js describe which
//       capability governs which CRUD cell, for the Administration permission views. Nothing calls
//       hasCapability with them.
//   (b) WORKFLOW / PAGE METADATA — adminWorkflowView.js's `capabilityId` is rendered as text by
//       AdminWorkflows.jsx; metadata entity/profile definitions declare `readCapability` /
//       `capabilityRequirement` / action `capability` for documentation and for server-side
//       resolution. metadata/query/queryModel.js's validateAuthority() has no callers today, and
//       the record pages that mount MetadataRecordPage without `capabilityDecisions`
//       (Equipment, Work Order, Sales Order) declare NO capability requirements — verified.
//   (c) ROLE-PREVIEW MECHANISM — previewHasPermission() (access/navPermissionPreview.js) resolves a
//       compatibility ROLE against the catalog locally. It is a different mechanism from the trusted
//       feed and is not subject to mode 3. Those sites are excluded by line content, not by file,
//       so a real feed gate in the same file is still caught.
//   (d) INERT-BY-DECLARATION CONSTANTS — domain/partLookup.js's INERT_LOOKUP_CAPABILITIES and
//       domain/financialPolicyView.js's reported capability name are display/documentation values.
const NON_GATE_ALLOWLIST = {
  "access/objectPermissionMap.js": "*",       // (a)
  "access/policyObjectRegistry.js": "*",      // (a)
  "domain/adminWorkflowView.js": "*",         // (b)
  "metadata/definitions": "*",                // (b) — prefix
  "metadata/administration": "*",             // (b) — prefix
  "metadata/query/queryModel.js": "*",        // (b)
  "domain/partLookup.js": ["inventory.serializedAsset.read", "inventory.location.display.read"], // (d)
  "domain/financialPolicyView.js": ["financialPolicy.profile.read"], // (d)
};

function allowed(rel, id) {
  for (const [key, value] of Object.entries(NON_GATE_ALLOWLIST)) {
    if (rel !== key && !rel.startsWith(key + "/")) continue;
    if (value === "*") return true;
    if (Array.isArray(value) && value.includes(id)) return true;
  }
  return false;
}

// ═══════════════════════════ A. STRUCTURAL ═══════════════════════════

test("REPORT_CAPABILITY_REQUEST is exactly the de-duplicated union of the declared shell gates", () => {
  assert.deepEqual([...REPORT_CAPABILITY_REQUEST], [...SHELL_GATED_CAPABILITY_IDS]);
  assert.equal(
    new Set(REPORT_CAPABILITY_REQUEST).size,
    REPORT_CAPABILITY_REQUEST.length,
    "a duplicate id would be sent twice in one request for no extra decision",
  );
  // The feed resolves one request per accessVersion; keep it a bounded, declared set.
  assert.ok(REPORT_CAPABILITY_REQUEST.length <= 100, `${REPORT_CAPABILITY_REQUEST.length} ids exceeds the feed's bound`);
});

test("every id of every declared shell gate is requested", () => {
  const asked = new Set(REPORT_CAPABILITY_REQUEST);
  for (const [surface, ids] of Object.entries(SHELL_CAPABILITY_GATES)) {
    assert.ok(Array.isArray(ids) && ids.length > 0, `${surface} declares no ids`);
    for (const id of ids) {
      assert.ok(asked.has(id), `${surface} gates on ${id}, which the shell never asks the feed about`);
    }
  }
});

test("the component-owned gate constants and the declaration are the same ids", () => {
  // equipmentCompatibilitySection.js deliberately imports nothing (stated invariant in its header),
  // so it keeps its own constant. This is what holds the two in step.
  assert.equal(EQUIPMENT_COMPATIBILITY_GATE.view, EQUIPMENT_COMPATIBILITY_VIEW);
  assert.ok(SCAN_WORKFLOW_CAPABILITY_IDS.includes(STOCK_RELOCATE_CAPABILITY));
  assert.deepEqual(Object.values(WAREHOUSE_RACKING_GATE), [
    "inventory.location.bin.read",
    "inventory.location.bin.manage",
  ]);
  assert.deepEqual(Object.values(FINANCIAL_POLICY_GATE), [
    "financialPolicy.profile.read",
    "financialPolicy.profile.configure",
  ]);
});

test("REGRESSION: the nine ids this defect class was found on are all requested", () => {
  // Six hand-patched historically, two reported by P3-A2, one more from P2-G's census. Listed by
  // name so a refactor that drops any of them fails loudly rather than silently going dark again.
  for (const id of [
    "customer.record.read", "opportunity.read",                       // My Dashboard
    "admin.dataImport.stage", "admin.dataImport.execute",             // Data Import
    "admin.userStatus.write", "admin.roleAssignment.write",           // Administration > Users
    "service.inboundWork.read", "administration.emailIntake.read",    // Inbound Work / Email
    "inventory.location.bin.manage",                                  // P3-A2 hit 1
    "inventory.stock.relocate",                                       // P3-A2 hit 2
    "financialPolicy.profile.read", "financialPolicy.profile.configure", // P2-G census
    "equipment.compatibility.view",                                   // P2-G census
  ]) {
    assert.ok(REPORT_CAPABILITY_REQUEST.includes(id), `${id} is gated in the UI but never requested`);
  }
});

// ═══════════════════════════ B. TEXTUAL ═══════════════════════════

test("no capability id is used in src/ without some request set asking about it", () => {
  const catalogued = catalogueIds();
  assert.ok(catalogued.size > 100, `catalogue parse produced only ${catalogued.size} ids`);

  const offences = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (CATALOGUE_FILES.has(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;            // comment-only line
      if (line.includes("previewHasPermission(")) return;      // reason (c): role-preview mechanism
      for (const match of line.matchAll(/"([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){1,4})"/g)) {
        const id = match[1];
        if (!catalogued.has(id)) continue;
        if (ASKED.has(id)) continue;
        if (allowed(rel, id)) continue;
        offences.push(`${rel}:${i + 1}  ${id}`);
      }
    });
  }
  assert.deepEqual(
    offences,
    [],
    "These capability ids appear in executable client code but no request set asks the trusted feed\n" +
      "about them. If the site is a GATE, declare it in access/shellCapabilityGates.js (or the\n" +
      "surface's own *_CAPABILITY_REQUEST) and import the id from there. If it is not a gate, add the\n" +
      "(file, id) pair to NON_GATE_ALLOWLIST in this file with a reason:\n  " +
      offences.join("\n  "),
  );
});
