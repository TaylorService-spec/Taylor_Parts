// CRM AUTHORITY ROUTE -- the PostgreSQL CRM cutover reaches ONLY a platform-sandbox build.
// Run: node --test test/crmAuthorityRoute.test.mjs
//
// The production-capable GitHub Pages bundle (taylor-parts-production) must keep the legacy Firestore CRM path
// exactly as it was; only platform-sandbox is authorized to use the EOS API (PostgreSQL CRM). The decision is made in
// src/domain/crmAuthorityRoute.js, baked into the bundle by vite.config.js as `__APP_CRM_VIA_EOS_API__`, and read by
// each routed module in one canonical line. This suite pins:
//   (a) the decision: true only for platform-sandbox, for every environment the registry declares;
//   (b) the dependency boundary: EOS-path modules import no Firebase business runtime, and the legacy Firestore
//       modules never import the CRM API client themselves;
//   (c) the selection: every routed module selects STATICALLY -- each EOS binding is referenced exactly once, in a
//       top-level `CRM_VIA_EOS_API ? <eos> : <firestore>` ternary -- so no try/catch or runtime branch can fall back
//       from one implementation to the other.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CRM_BUILD_ENVIRONMENT_ID,
  CRM_EOS_API_ENVIRONMENTS,
  CRM_VIA_EOS_API,
  crmViaEosApiFor,
} from "../src/domain/crmAuthorityRoute.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const srcDir = path.join(appDir, "src");
const read = (rel) => readFileSync(path.join(appDir, rel), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.(js|jsx|mjs)$/.test(entry) ? [full] : [];
  });
}
const rel = (full) => path.relative(appDir, full).split(path.sep).join("/");

// ─────────────────────────────── (a) the decision ───────────────────────────────

test("the allowlist is exactly platform-sandbox", () => {
  assert.deepEqual([...CRM_EOS_API_ENVIRONMENTS], ["platform-sandbox"]);
  assert.ok(Object.isFrozen(CRM_EOS_API_ENVIRONMENTS));
});

test("CRM uses the EOS API for platform-sandbox and for NO other environment", () => {
  assert.equal(crmViaEosApiFor("platform-sandbox"), true);
  for (const id of ["taylor-parts-production", "platform-certification", "platform-integration", "local-emulator",
    "test-sandbox", "Platform-Sandbox", "platform-sandbox ", "", null, undefined, 42]) {
    assert.equal(crmViaEosApiFor(id), false, `${String(id)} must keep the legacy Firestore CRM path`);
  }
});

test("every environment the registry declares is decided, and only platform-sandbox routes to the EOS API", () => {
  const registry = JSON.parse(readFileSync(path.resolve(appDir, "../config/environments.json"), "utf8"));
  const ids = registry.environments.map((e) => e.id);
  for (const expected of ["local-emulator", "platform-sandbox", "platform-certification", "platform-integration", "taylor-parts-production"]) {
    assert.ok(ids.includes(expected), `registry no longer declares ${expected} -- re-examine this route`);
  }
  assert.deepEqual(ids.filter(crmViaEosApiFor), ["platform-sandbox"]);
  assert.equal(crmViaEosApiFor(registry.defaultEnvironmentId), false, "the default (unset VITE_ENVIRONMENT_ID) build is legacy");
});

test("absent a baked environment (plain node), the route is legacy -- absent never means EOS", () => {
  assert.equal(CRM_BUILD_ENVIRONMENT_ID, null);
  assert.equal(CRM_VIA_EOS_API, false);
  assert.equal(typeof globalThis.__APP_CRM_VIA_EOS_API__, "undefined");
});

test("vite.config.js bakes the define from the route's own decision, and vitest leaves it undefined", () => {
  const vite = stripComments(read("vite.config.js"));
  assert.match(vite, /import \{ crmViaEosApiFor \} from '\.\/src\/domain\/crmAuthorityRoute\.js'/);
  assert.match(vite, /__APP_CRM_VIA_EOS_API__: JSON\.stringify\(crmViaEosApiFor\(APP_ENV\.id\)\)/);
  assert.doesNotMatch(stripComments(read("vitest.config.js")), /__APP_CRM_VIA_EOS_API__/,
    "the component harness must run the legacy path unless a suite opts in explicitly");
});

// ─────────────────────────────── the routed modules ───────────────────────────────

const CANONICAL = 'const CRM_VIA_EOS_API = typeof __APP_CRM_VIA_EOS_API__ === "boolean" && __APP_CRM_VIA_EOS_API__;';

/** Modules that SELECT between a legacy Firestore implementation and an EOS API implementation. */
const SELECTORS = {
  "src/domain/accounts.js": ["createAccount", "updateAccount"],
  "src/domain/contacts.js": ["createContact", "updateContact"],
  "src/domain/locations.js": ["createLocation", "updateLocation"],
  "src/domain/contactImport.js": ["importContacts"],
  "src/hooks/useAccount.js": ["useAccount"],
  "src/hooks/useAccountPicker.js": ["useAccountPicker"],
  "src/hooks/useAccountPortfolioSummary.js": ["useAccountPortfolioSummary"],
  "src/hooks/useAccountSearch.js": ["useAccountSearch"],
  "src/hooks/useContactsForAccount.js": ["useContactsForAccount"],
  "src/hooks/useLocation.js": ["useLocation"],
  "src/hooks/useLocationsForAccount.js": ["useLocationsForAccount"],
  "src/hooks/useLocationsForAccounts.js": ["useLocationsForAccounts"],
  "src/hooks/useAccountNames.js": ["readAccountNameMap"],
  "src/hooks/useLocationReferenceResolver.js": ["readLocationNameMap"],
  "src/hooks/useInstalledEquipmentPage.js": ["defaultReadNames"],
  "src/hooks/useMetadataList.js": ["fetchCrmAccountPageForBuild"],
};

/** Modules that only adapt PRESENTATION to the route; they select no implementation. */
const PRESENTATION = [
  "src/domain/commercialProfile.js",
  "src/metadata/definitions/account.js",
  "src/metadata/entityDefinition.js",
  "src/modules/accounts/AccountDetail.jsx",
];

const EOS_PATH = () => [
  ...walk(path.join(srcDir, "domain", "crm", "eosApi")),
  ...walk(path.join(srcDir, "hooks", "crm", "eosApi")),
  path.join(srcDir, "metadata", "crmListSource.js"),
].map(rel);

test("the census is complete: every module that reads the route is listed, and each uses the canonical line", () => {
  const declaring = walk(srcDir).map(rel).filter((f) => /__APP_CRM_VIA_EOS_API__/.test(stripComments(read(f))));
  assert.deepEqual(declaring.sort(), [...Object.keys(SELECTORS), ...PRESENTATION].sort());
  for (const f of declaring) {
    const code = read(f);
    assert.equal(code.split(CANONICAL).length - 1, 1, `${f}: declare CRM_VIA_EOS_API exactly once, canonically`);
  }
});

test("no module IMPORTS the flag: an imported constant is not folded early enough to tree-shake the unselected side", () => {
  const importers = walk(srcDir).map(rel).filter((f) => /from\s+["'][^"']*crmAuthorityRoute(\.js)?["']/.test(stripComments(read(f))));
  assert.deepEqual(importers, []);
});

// ─────────────────────────────── (b) the dependency boundary ───────────────────────────────

const importSpecifiers = (code) => [...stripComments(code).matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)]
  .map((m) => m[1] ?? m[2] ?? m[3]);

test("no EOS-path module imports firebase/* or the app's firebase modules", () => {
  const files = EOS_PATH();
  assert.ok(files.length >= 14, `found only ${files.length} EOS-path modules -- the walk is not reading the tree`);
  for (const f of files) {
    for (const spec of importSpecifiers(read(f))) {
      assert.doesNotMatch(spec, /^firebase(\/|$)|(^|\/)firebase\//, `${f} imports ${spec}`);
      assert.doesNotMatch(spec, /crmCutoverFreeze|collectionStore/, `${f} imports ${spec}`);
    }
  }
});

test("the CRM API client takes only the Firebase Auth token (identity), never a Firebase business runtime", () => {
  const code = stripComments(read("src/services/crmApiClient.js"));
  const firebaseImports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']*firebase[^"']*)["']/g)].map((m) => [m[1].trim(), m[2]]);
  assert.deepEqual(firebaseImports, [["auth", "../firebase/firebase.js"]]);
  assert.doesNotMatch(code, /firebase\/firestore|firebase\/functions|httpsCallable/);
});

test("no legacy Firestore-path module imports the CRM API client or the CRM list source directly", () => {
  for (const f of Object.keys(SELECTORS).filter((f) => f !== "src/hooks/useMetadataList.js")) {
    for (const spec of importSpecifiers(read(f))) {
      assert.doesNotMatch(spec, /crmApiClient|crmListSource/, `${f} reaches the EOS API directly (${spec}); route it through crm/eosApi`);
    }
  }
  for (const f of PRESENTATION) {
    for (const spec of importSpecifiers(read(f))) {
      assert.doesNotMatch(spec, /crmApiClient|crmListSource|\/crm\/eosApi\//, `${f} is presentation-only and must not import an EOS implementation`);
    }
  }
});

// ─────────────────────────────── (c) static selection, no fallback ───────────────────────────────

test("every routed module selects ONCE, with a top-level ternary, and references each EOS binding only there", () => {
  for (const [f, selected] of Object.entries(SELECTORS)) {
    const code = stripComments(read(f));
    const eosBindings = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)]
      .filter((m) => /\/crm\/eosApi\/|crmListSource\.js$/.test(m[2]))
      .flatMap((m) => m[1].split(",").map((part) => part.trim().split(/\s+as\s+/).pop()).filter(Boolean));
    assert.equal(eosBindings.length, selected.length, `${f}: expected one EOS binding per selection, found ${eosBindings}`);

    for (const name of selected) {
      const selection = new RegExp(`^(export )?const ${name} = CRM_VIA_EOS_API \\? ([\\w$]+) : ([\\w$]+);$`, "m").exec(code);
      assert.ok(selection, `${f}: ${name} is not selected by a top-level \`CRM_VIA_EOS_API ? eos : firestore\` ternary`);
      const [, , eos, legacy] = selection;
      assert.ok(eosBindings.includes(eos), `${f}: ${name}'s EOS branch (${eos}) is not an imported EOS implementation`);
      if (legacy !== "null") assert.ok(!eosBindings.includes(legacy), `${f}: ${name} selects an EOS binding on both sides`);
    }
    for (const binding of eosBindings) {
      const uses = code.match(new RegExp(`(?<![\\w$.])${binding.replace(/\$/g, "\\$")}(?![\\w$])`, "g")) ?? [];
      // one in the import clause, one in the selecting ternary -- nothing else may call it
      assert.equal(uses.length, 2, `${f}: ${binding} is referenced outside its selection (a fallback or a second path)`);
    }
  }
});

test("the selection is taken at module load, never inside a try/catch", () => {
  for (const f of Object.keys(SELECTORS)) {
    const code = stripComments(read(f));
    for (const m of code.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)) {
      // The text from the catch to the end of its block must not name an EOS implementation or the flag.
      let depth = 0; let i = m.index + m[0].length - 1; const start = i;
      for (; i < code.length; i += 1) { if (code[i] === "{") depth += 1; else if (code[i] === "}" && --depth === 0) break; }
      const block = code.slice(start, i);
      assert.doesNotMatch(block, /EosApi|CRM_VIA_EOS_API|callCrmApi|requireCrmApi/, `${f}: a catch block reaches the other CRM implementation`);
    }
  }
});

test("the legacy Firestore implementations and the platform-sandbox client fuse are still in place", () => {
  assert.match(read("src/domain/crmCutoverFreeze.js"), /CRM_CUTOVER_FROZEN_ENVIRONMENT\s*=\s*"platform-sandbox"/);
  for (const [f, fn] of [["src/domain/accounts.js", "createAccountFirestore"], ["src/domain/contacts.js", "createContactFirestore"],
    ["src/domain/locations.js", "createLocationFirestore"], ["src/domain/contactImport.js", "importContactsFirestore"]]) {
    assert.match(read(f), new RegExp(`function ${fn}\\(`), `${f}: legacy ${fn} is gone`);
    assert.match(read(f), /assertClientCrmWriterOpen\(/, `${f}: the client fuse is gone`);
  }
});
