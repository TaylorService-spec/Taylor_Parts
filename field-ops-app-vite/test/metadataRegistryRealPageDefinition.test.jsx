// LEDGER.md X-REGISTRY-VALIDATOR-NEVER-RUN + X-UNCONSUMED-DECLARATION-PATTERN.
//
// registry.js's validateRegistryReferences and pageDefinition.js's pageRegistryReferences had
// only ever been called by their own unit tests, fed hand-built objects. This file is the
// missing real consumer for the PageDefinition side of that gap: the real accountRecordPage
// (src/metadata/definitions/accountPage.js), checked against the REAL, application-populated
// componentRegistry — driven by the REAL registerAccountPageComponents() function
// (src/metadata/definitions/accountPageComponents.js), not a hand-built stand-in for it.
//
// WHY THIS IS A SEPARATE FILE FROM test/metadataRegistry.test.mjs (NOT a workaround) —
// registerAccountPageComponents() is application code: importing
// accountPageComponents.js pulls in React, react-router hooks, and an extensionless
// `../../firebase/firebase` module specifier (plus several `.jsx` component imports under
// src/modules/accounts/). Plain `node --test` cannot resolve any of that — verified directly
// while building this file:
//
//   $ node -e "import('./src/metadata/definitions/accountPageComponents.js')"
//   Cannot find module '.../src/firebase/firebase' imported from
//   '.../src/metadata/definitions/accountPageComponents.js'
//   Error [ERR_MODULE_NOT_FOUND]: ...
//
// That is not a workaround-able typo — Node's ESM resolver requires an explicit extension on
// a relative specifier, and this repo's source relies on Vite's bundler-style resolution
// (extensionless imports, `.jsx` parsing) everywhere outside test/**/*.test.mjs. The REAL
// registration function can only run inside a Vite/esbuild-aware pipeline — vitest + jsdom is
// that pipeline, and is already proven to work for exactly this module by
// test/accountPageComponents.test.jsx's own "registerAccountPageComponents" describe block.
// This file does not reinvent that proof; it adds the one thing that block does not do: run
// the module's own componentId/action REFERENCES through the real registry.js validator
// functions (pageRegistryReferences + a has()-based check mirroring
// validateRegistryReferences), rather than re-deriving the id list by hand.
//
// WHAT THIS PROVES: every componentId and action id accountRecordPage (and the two subsets
// actually wired into AccountDetail.jsx) names is registered by the SAME registration call
// production makes at module load. It does NOT prove anything about ListViewDefinitions
// (covered separately, and today vacuously, in test/metadataRegistry.test.mjs — see that
// file's own note on why) and does NOT prove the registered COMPONENT is the right one to
// render, or that registerAccountPageComponents() itself runs at production startup (it does,
// via accountPageComponents.js's own top-level `registerAccountPageComponents();` call — a
// fact this file relies on but does not re-verify).
//
// REGISTRATION_PENDING — this file is new. Nothing in .github/workflows/*.yml or
// package.json's "test"/"test:components" scripts (both shared, out of this lane's
// writeScope) names it, so it is not yet executed by CI. It CAN be run directly today:
//
//   npx vitest run test/metadataRegistryRealPageDefinition.test.jsx
//
// A new test file that nothing runs is exactly the class of bug this lane exists to fix —
// stating that plainly rather than leaving it implicit.

import { describe, it, expect, beforeEach } from "vitest";
import { componentRegistry, actionRegistry } from "../src/metadata/registry.js";
import { pageRegistryReferences } from "../src/metadata/pageDefinition.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import {
  registerAccountPageComponents,
  accountRecordPageMainSubset,
  accountRecordPageSideSubset,
} from "../src/metadata/definitions/accountPageComponents.js";

/** Same reporting shape as registry.js's own validateRegistryReferences, driven by the
 * correctly-PageDefinition-shaped pageRegistryReferences instead of registry.js's
 * list-shaped referencedRegistryIds (which reads `.regions`/`.rowActions`/`.actions` — fields
 * a PageDefinition does not have; calling it directly on accountRecordPage would silently
 * find zero references and "pass" without checking anything). */
function validatePageAgainstRegistries(def) {
  const problems = [];
  const at = def?.id ? `definition ${def.id}` : "definition";
  const { components, actions } = pageRegistryReferences(def);
  for (const id of components) {
    if (!componentRegistry.has(id)) problems.push(`${at}: references unregistered component "${id}"`);
  }
  for (const id of actions) {
    if (!actionRegistry.has(id)) problems.push(`${at}: references unregistered action "${id}"`);
  }
  return problems;
}

describe("validatePageAgainstRegistries (pageRegistryReferences + registry.js) over the real accountRecordPage", () => {
  beforeEach(() => {
    componentRegistry.__resetForTest();
    actionRegistry.__resetForTest();
  });

  it("accountRecordPage references at least one component today — there is something real to check", () => {
    const { components, actions } = pageRegistryReferences(accountRecordPage);
    expect(components.length).toBeGreaterThan(0);
    // LIVE FINDING CHECK, not an assumption: as of this writing accountRecordPage declares
    // no headerActions and no section-level `actions` — recorded here as an executable fact,
    // not a comment, so it goes stale loudly (as a failing assertion) rather than silently
    // the moment a real action id is added without this file being told.
    expect(actions).toEqual([]);
  });

  it("BEFORE registration: every real componentId is (correctly) reported unregistered", () => {
    // Proves this check is live, using the real definition rather than a synthetic one — the
    // registry is empty (beforeEach reset) and registerAccountPageComponents() has not run in
    // this test, matching what a definition would see if rendered before app startup finished
    // registering. If this assertion ever passes with an EMPTY problems list, the check below
    // ("AFTER registration") would not be proving anything.
    const problems = validatePageAgainstRegistries(accountRecordPage);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => /references unregistered component/.test(p))).toBe(true);
  });

  it("AFTER the REAL registerAccountPageComponents(): every componentId/action accountRecordPage names is registered", () => {
    // The real application registration function — the same one accountPageComponents.js's
    // own module-load side effect calls in production — not a hand-built registry standing
    // in for it. registerAccountPageComponents() itself throws if accountPage.js ever names a
    // componentId this module has no adapter for (see its own source), so a passing call here
    // already guarantees COMPONENT_MAP covers every id; this test additionally proves that
    // fact through the actual registry.js/pageDefinition.js validator path, not through
    // COMPONENT_MAP introspection.
    registerAccountPageComponents();
    const problems = validatePageAgainstRegistries(accountRecordPage);
    expect(problems).toEqual([]);
  });

  it("the two subsets actually wired into AccountDetail.jsx (MAIN + SIDE) are also fully registered", () => {
    registerAccountPageComponents();
    for (const def of [accountRecordPageMainSubset, accountRecordPageSideSubset]) {
      const problems = validatePageAgainstRegistries(def);
      expect(problems).toEqual([]);
    }
  });
});
