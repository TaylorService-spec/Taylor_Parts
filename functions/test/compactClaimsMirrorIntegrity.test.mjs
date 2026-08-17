// Access-contract mirror integrity.
//
// SUPERSEDED MECHANISM, KEPT FILE. This suite used to diff each mirrored pair
// after normalizing away two legitimate differences: the self-referential
// cross-reference path (each copy named the other's location) and the WRAP POINT
// of the sentence containing it, since the two paths differ in length. That
// normalization existed only because the file bodies encoded a pathname.
//
// scripts/syncAccessContracts.mjs removes the cause instead of tolerating it. The
// canonical body no longer names either location, the client copy is GENERATED as
// a neutral banner plus that body verbatim, and verification is therefore exact
// byte comparison — no comment-paragraph joining, no CRLF regex, nothing to get
// subtly wrong. A byte check is strictly stronger than the normalized one it
// replaces: everything the old check would have caught, this catches, plus
// whitespace and wrap differences it deliberately forgave.
//
// The file is kept (rather than deleted) because it is named in
// functions/package.json's test:access script and in the access-catalog workflow,
// and because "the mirrors agree" is still exactly the question being asked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SYNCED_MODULES,
  GENERATED_BANNER,
  generate,
  syncAll,
} from "../../scripts/syncAccessContracts.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

check("every synced access contract's generated copy matches its canonical source exactly", () => {
  const { drift } = syncAll({ check: true, root: REPO_ROOT });
  assert.deepEqual(
    drift,
    [],
    "generated access contracts are out of sync — run: node scripts/syncAccessContracts.mjs",
  );
});

check("the generated copy is exactly the banner plus the canonical body, byte for byte", () => {
  // Asserts the generator's own contract rather than trusting its self-report, so a
  // generator that silently produced nothing would still fail here.
  for (const moduleFile of SYNCED_MODULES) {
    const canonical = readFileSync(join(REPO_ROOT, "functions", "src", "access", moduleFile), "utf8");
    const generated = readFileSync(
      join(REPO_ROOT, "field-ops-app-vite", "src", "access", moduleFile),
      "utf8",
    ).replace(/\r\n/g, "\n");
    assert.equal(generated, generate(canonical), `${moduleFile}: generated copy is not banner + canonical body`);
  }
});

check("generation is deterministic — the same input yields the same bytes", () => {
  // A generator whose output varies run to run cannot be CI-verified, and the failure
  // would present as mysterious intermittent drift rather than as a bug in the generator.
  const sample = readFileSync(join(REPO_ROOT, "functions", "src", "access", SYNCED_MODULES[0]), "utf8");
  assert.equal(generate(sample), generate(sample));
});

check("no canonical access contract still encodes a peer pathname", () => {
  // The regression guard for the whole design: if a pathname creeps back into a
  // canonical body, the two copies acquire a reason to differ and the generator would
  // have to start rewriting prose again.
  for (const moduleFile of SYNCED_MODULES) {
    const canonical = readFileSync(join(REPO_ROOT, "functions", "src", "access", moduleFile), "utf8");
    assert.ok(
      !canonical.includes("field-ops-app-vite/src/access/"),
      `${moduleFile}: canonical body names the generated copy's path — that is what forced the copies to differ`,
    );
  }
});

check("the generated copy carries an unmistakable do-not-edit banner", () => {
  for (const moduleFile of SYNCED_MODULES) {
    const generated = readFileSync(
      join(REPO_ROOT, "field-ops-app-vite", "src", "access", moduleFile),
      "utf8",
    ).replace(/\r\n/g, "\n");
    assert.ok(generated.startsWith(GENERATED_BANNER), `${moduleFile}: missing or misplaced generated banner`);
    assert.match(generated, /DO NOT EDIT/, `${moduleFile}: banner must say so plainly`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
