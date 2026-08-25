// IS THE TECHNICIAN SHELL ACTUALLY REACHABLE?
// Run: node --test test/technicianShellReachability.test.mjs   (also `npm test`)
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// WO-02 built TechnicianShell — Home, Jobs, Scan, More, a bottom thumb bar, mobile certification,
// twenty passing tests. WO-03 wired the offline runtime into it. Both slices were reported as
// complete and both were, component by component.
//
// It was imported by NOTHING. Every test rendered it directly, so every test passed, and no
// technician could open it. A whole handheld app existed and was reachable from nowhere for two
// slices, and the only reason it surfaced was somebody reading imports by hand.
//
// A rendered test cannot catch this: rendering a component IS an import, so the very act of testing
// it satisfies the thing you would try to assert. So this is a STRUCTURAL test over the source, and
// it deliberately looks at the ROUTE TABLE rather than at any test file.
//
// ============================ WHY THE ASSERTIONS LOOK PARANOID ============================
//
// Each one closes a way of technically satisfying the guard while leaving the shell unreachable:
// imported but never rendered, rendered but not from the route table, or reachable only from a file
// that nothing ships.
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => readFileSync(path.resolve(root, rel), "utf8");

const APP = read("src/App.jsx");
const SHELL = read("src/modules/technician/TechnicianShell.jsx");

/** Every shipped source file — src only. A test file importing the shell proves nothing. */
function shippedSources(dir = path.resolve(root, "src"), found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) shippedSources(full, found);
    else if (/\.(jsx?|tsx?)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("TechnicianShell is reachable", () => {
  test("IT IS IMPORTED BY SHIPPED SOURCE, not only by tests", () => {
    const importers = shippedSources()
      .filter((f) => !f.endsWith(path.join("technician", "TechnicianShell.jsx")))
      .filter((f) => /from\s+["'][^"']*TechnicianShell["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    assert.ok(
      importers.length > 0,
      "TechnicianShell is imported by nothing that ships. It was orphaned for two whole slices this way.",
    );
    // The route table specifically. An import from some other component could itself be unreachable.
    assert.ok(
      importers.some((f) => f.endsWith(path.join("src", "App.jsx"))),
      `expected src/App.jsx to import it; found only ${importers.join(", ")}`,
    );
  });

  test("it is RENDERED, not merely imported", () => {
    assert.match(APP, /<TechnicianShell\s*\/>/, "imported but never rendered is still unreachable");
  });

  test("the render is reached from the route table, under the technician workspace slot", () => {
    // The nav item that owns the technician surface. If somebody renames the key, this fails rather
    // than silently routing nowhere.
    assert.match(APP, /item\.key === "technicianWorkspace"/);
    const nav = read("src/navigation/navConfig.js");
    assert.match(nav, /key:\s*"technicianWorkspace"/, "the nav item must still exist");
    assert.match(nav, /path:\s*"technician-workspace"/, "and still have a URL");
  });

  test("ALL FOUR TABS are reachable within the shell", () => {
    // Home / Jobs / Scan / More come from the governed HANDHELD_TABS list, and each must have a
    // branch that renders something. A tab that renders nothing is a dead button.
    const handheld = read("src/domain/technicianHandheld.js");
    for (const key of ["home", "jobs", "scan", "more"]) {
      assert.match(handheld, new RegExp(`key:\\s*"${key}"`), `HANDHELD_TABS must declare ${key}`);
      assert.match(SHELL, new RegExp(`tab === "${key}"`), `the shell must render a branch for ${key}`);
    }
  });

  test("the tab bar is driven by the governed list, not a second hardcoded one", () => {
    assert.match(SHELL, /HANDHELD_TABS\.map/);
  });

  test("More reaches the sync queue — the queue is never hidden", () => {
    assert.match(SHELL, /SyncQueue/, "More must be able to open the queue");
    assert.match(SHELL, /MORE_ITEMS\.map/);
  });

  test("DESKTOP IS NOT FORCED INTO THE PHONE SHELL", () => {
    // Width picks the composition; both branches exist, so a desktop user keeps the desktop surface.
    assert.match(APP, /useIsPhone\(\)\s*\?\s*<TechnicianShell\s*\/>\s*:\s*<FieldMode\s*\/>/);
  });

  test("WIDTH NEVER DECIDES AUTHORITY", () => {
    // The one thing a breakpoint must never do. If a capability check ever appears next to the
    // viewport hook, this fails and somebody has to justify it.
    const hook = read("src/navigation/useIsPhone.js");
    assert.ok(!/hasCapability|permission|role\b|canInstall/.test(hook),
      "the viewport hook must not reason about authority");
  });
});

describe("one queue, not two", () => {
  test("the shell PROVIDES the runtime and FieldMode consumes it", () => {
    // Both surfaces want the offline runtime, and the shell renders FieldMode. Two runtimes over one
    // storage key means two writers, and the loser's captured work disappears with no error.
    assert.match(SHELL, /OfflineRuntimeProvider/);
    const field = read("src/modules/mobile/FieldMode.jsx");
    assert.match(field, /useProvidedOfflineRuntime/);
    assert.match(field, /disabled:\s*!!provided/,
      "FieldMode must not open a second queue when one is provided above it");
  });
});

describe("no authority widened by mounting the shell", () => {
  const OFFLINE_SOURCES = [
    "src/offline", "src/modules/mobile", "src/modules/technician", "src/hooks/useOfflineRuntime.js",
  ];

  function filesUnder(rel) {
    const full = path.resolve(root, rel);
    if (!statSync(full).isDirectory()) return [full];
    return readdirSync(full).flatMap((e) => filesUnder(path.join(rel, e)));
  }

  test("NOT ONE CLIENT-DIRECT FIRESTORE WRITE", () => {
    // Everything a technician records goes through a governed callable, which resolves capability on
    // the server. A direct write would bypass that entirely, and the collections involved are
    // deny-all to clients anyway -- so this would fail at runtime AND be wrong.
    const offenders = OFFLINE_SOURCES.flatMap(filesUnder)
      .filter((f) => /\.(jsx?|tsx?)$/.test(f))
      .filter((f) => /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch)\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    assert.deepEqual(offenders, []);
  });

  test("the queue reaches ONLY the five commands that already existed", () => {
    // The bindings file is the single place an intent becomes a request. If a new callable name
    // appears here, somebody has added a call path that no review covered.
    const bindings = read("src/offline/technicianCommandBindings.js");
    const imported = [...bindings.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)]
      .filter(([, , from]) => from.includes("services/"))
      // A multi-line import ends with a trailing comma, which splits into an empty final entry.
      .flatMap(([, names]) => names.split(",").map((n) => n.trim()).filter(Boolean));
    assert.deepEqual(imported.sort(), [
      "fetchInstallableEquipmentForWorkOrder",
      "getWorkOrder",
      "recordWorkOrderEquipmentInstall",
      "recordWorkOrderLabor",
      "transitionWorkOrder",
      "updateWorkOrderExecutionData",
    ]);
  });

  test("install NEVER sends a client-chosen customer or location", () => {
    // The command derives both from the Work Order and refuses a request that supplies them. A
    // device is not a source of truth about where a machine went.
    const capture = read("src/offline/technicianIntentCapture.js");
    assert.ok(!/accountId|customerId:|locationId:/.test(capture),
      "the install intent must not carry customer or location");
  });

  test("no backend surface is reachable from the technician client", () => {
    const bindings = read("src/offline/technicianCommandBindings.js");
    assert.ok(!/firestore\.rules|roleAssignments|GOVERNED_BUSINESS_ROLES/.test(bindings));
  });
});
