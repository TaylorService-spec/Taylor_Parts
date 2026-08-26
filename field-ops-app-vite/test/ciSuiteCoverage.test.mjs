// CI COVERAGE GUARD — no test may be added that CI never runs.
// Run: node --test test/ciSuiteCoverage.test.mjs
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// This repository has no glob lane for client vitest suites: a `.test.jsx` file runs in CI only
// where a workflow names it. That is easy to forget, and a forgotten suite is worse than a missing
// one — it passes locally, it looks like coverage in review, and a regression it would have caught
// merges anyway.
//
// It has already happened twice: Phase D's two suites were merged unnamed and had never run in CI
// once by the time Phase E found them, and a later audit put the total at 61.
//
// ============================ HOW THIS GUARD WORKS ============================
//
// Every `test/*.test.jsx` must be named by some `.github/workflows/*.yml`, OR appear in the
// allowlist below. The allowlist is a BURN-DOWN LIST, not an exemption: it is seeded with the debt
// that already existed, and it may only ever shrink. Nothing new may be added to it — a NEW unnamed
// suite fails this test, which is the whole point.
//
// ============================ THE SAME HOLE, ON THE OTHER RUNNER ============================
//
// This guard originally said node:test suites "do not need listing here: they are registered in
// test/suites.json and run by `npm test`". That sentence described the INTENT, not the state. It
// was checked while migrating the Sales Order page family and it was false: five `.test.mjs` files
// were in neither test/suites.json nor any workflow, so nothing ran them -- among them
// test/workOrderNorthStar.test.mjs, the falsifiable-contract suite for a page family that had
// already been declared closed on the strength of a green CI run.
//
// That is precisely the failure this file was written to stop, arriving through the door the file
// had assumed was shut. So the same rule now applies to both runners: a node:test suite must be
// registered in test/suites.json OR named by a workflow. There is deliberately NO allowlist on this
// side -- the debt was five files, all of them passing, and all five were registered rather than
// recorded. An allowlist seeded at zero is just a place for the next one to go.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.resolve(here, "../../.github/workflows");

/**
 * Suites that were already unnamed when this guard was written.
 *
 * SHRINK ONLY. Registering one of these in a real workflow — ideally the lane that owns its
 * subsystem — and deleting the line here is the fix. Adding a line is not.
 */
const KNOWN_UNNAMED = new Set([
  "accountArSection.test.jsx", "accountPageComponents.test.jsx", "activeLabelConformance.test.jsx",
  "activitySection.test.jsx", "administrationVersionDeploymentInfo.test.jsx",
  "appRailActiveServiceGroup.test.jsx", "appShellDrawerLocation.test.jsx",
  "compositionPrimitives.test.jsx", "designSystemFoundationPrimitives.test.jsx", "dispatchCancelledChip.test.jsx",
  "dispatchCancelledMessage.test.jsx", "emptyStateGuidance.test.jsx",
  "equipmentDetailAccountFailClosed.test.jsx", "equipmentTimeline.test.jsx",
  "executionAnalyticsService.test.jsx", "executionCaptureOverPlanGuard.test.jsx",
  "fieldDispatchSafeCopySweep.test.jsx", "fieldErrorCopyLeak.test.jsx",
  "inventoryRoleReadErrorContract.test.jsx", "jobsNewWorkOrderActionGate.test.jsx",
  "loadingEmptyStateFailure.test.jsx", "loginHistoryNavigation.test.jsx",
  "manageTruckDrawerReadinessGate.test.jsx", "mobileInventorySections.test.jsx",
  "onHandGovernedLedger.test.jsx", "operationalCard.test.jsx",
  "operationsProcurementLiveSource.test.jsx", "opportunitySectionSaveUi.test.jsx", "ownerSelect.test.jsx",
  "partDetailReorderReenable.test.jsx", "partsStockSection.test.jsx", "performanceSnapshotErrorState.test.jsx",
  "reconciliationHonestyM15.test.jsx",
  "reconciliationSection.test.jsx", "reorderConsumersDeniedVsAbsent.test.jsx",
  "reorderPurchaseOrderReadErrorContract.test.jsx",
  "reportBuilderArrayFilterAndSavedWiring.test.jsx", "reservationsSection.test.jsx",
  "salesOrderActionsDestructiveStyling.test.jsx", "schedulingWorkspace.test.jsx",
  "serializedAssetsSection.test.jsx", "supplierPicker.test.jsx",
  "technicianWorkOrderActionsCompletionHonesty.test.jsx", "techniciansErrorState.test.jsx",
  "truckManagementCommandClient.test.jsx", "truckManagementView.test.jsx",
  "useInstalledEquipmentPage.test.jsx", "useSalesOrderActions.test.jsx",
  "useSchedulingDataErrorState.test.jsx", "useTruckManagement.test.jsx", "useTruckRegistrySource.test.jsx",
  "workOrderAndLocationReadErrorContract.test.jsx", "workOrderDetailPageErrorState.test.jsx",
  "workOrderPreviewCustomerIdentity.test.jsx",
]);

function namedByWorkflows() {
  const named = new Set();
  for (const file of readdirSync(workflowsDir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const text = readFileSync(path.join(workflowsDir, file), "utf8");
    for (const match of text.matchAll(/[\w./-]+\.test\.jsx/g)) {
      named.add(path.basename(match[0]));
    }
  }
  return named;
}

const vitestSuites = () =>
  readdirSync(here).filter((f) => f.endsWith(".test.jsx"));

test("every vitest suite is named by a workflow, or is known debt", () => {
  const named = namedByWorkflows();
  const orphans = vitestSuites().filter((f) => !named.has(f) && !KNOWN_UNNAMED.has(f));
  assert.deepEqual(
    orphans,
    [],
    `These vitest suites will NEVER run in CI. Name each one in the workflow that owns its subsystem:\n  ${orphans.join("\n  ")}`,
  );
});

test("the allowlist may only SHRINK — every entry must still be a real, unnamed file", () => {
  // A stale entry is how an allowlist quietly becomes permission. If a suite was deleted or has
  // since been named, its line must go, so the list can never be padded back out.
  const present = new Set(vitestSuites());
  const named = namedByWorkflows();
  const stale = [...KNOWN_UNNAMED].filter((f) => !present.has(f) || named.has(f));
  assert.deepEqual(
    stale,
    [],
    `These allowlist entries are no longer unnamed orphans and must be removed:\n  ${stale.join("\n  ")}`,
  );
});

test("the debt is going DOWN, and the number is stated rather than implied", () => {
  // A count nobody looks at is a count nobody reduces. When this figure drops, lower the ceiling —
  // that is what makes the list a burn-down rather than a parking space.
  //
  // 61 -> 54: the six scanner-adjacent suites were registered in scan-workspace-tests.yml, which is
  // the lane that owns their subsystems. The ceiling came down with them, so the space they freed
  // cannot be quietly reoccupied.
  const CEILING = 54;
  assert.ok(
    KNOWN_UNNAMED.size <= CEILING,
    `The unnamed-suite allowlist grew to ${KNOWN_UNNAMED.size}. It may only shrink.`,
  );
});

// ───────────────────────── the same rule, for node:test suites

/** Suite files named by any workflow, either runner. */
function namedByWorkflowsAnyRunner() {
  const named = new Set();
  for (const file of readdirSync(workflowsDir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const text = readFileSync(path.join(workflowsDir, file), "utf8");
    for (const match of text.matchAll(/[\w./-]+\.test\.mjs/g)) {
      named.add(path.basename(match[0]));
    }
  }
  return named;
}

/** The manifest `npm test` actually runs. Read fresh so a stale copy cannot vouch for itself. */
function registeredSuites() {
  const manifest = JSON.parse(readFileSync(path.join(here, "suites.json"), "utf8"));
  return new Set(manifest.suites.map((s) => path.basename(s.file)));
}

test("every node:test suite is run by SOMETHING — the manifest or a workflow", () => {
  const registered = registeredSuites();
  const named = namedByWorkflowsAnyRunner();
  const orphans = readdirSync(here)
    .filter((f) => f.endsWith(".test.mjs"))
    .filter((f) => !registered.has(f) && !named.has(f));
  assert.deepEqual(
    orphans,
    [],
    `These node:test suites will NEVER run in CI. Register each in test/suites.json, or name it in\nthe workflow that owns its subsystem:\n  ${orphans.join("\n  ")}`,
  );
});

test("the manifest names no suite that does not exist", () => {
  // The mirror of the rule above, and the reason it matters: runSuites.mjs is what decides whether a
  // missing file is a failure or a silent skip. A manifest entry for a deleted file is a claim of
  // coverage with nothing behind it.
  const present = new Set(readdirSync(here));
  const missing = [...registeredSuites()].filter((f) => !present.has(f));
  assert.deepEqual(missing, [], `test/suites.json names files that do not exist:\n  ${missing.join("\n  ")}`);
});
