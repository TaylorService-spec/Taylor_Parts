// ON-HAND SIGN AUTHORITY RATCHET — a seventh copy of the sign rule may not appear.
//
// ============================ WHY A SOURCE-SCANNING TEST ============================
//
// inventoryLedger/locationOnHand.ts exists because "RECEIVED adds, TRANSFER_OUT subtracts, ADJUSTED
// carries its own sign" had been written out FIVE times. When Decision #171 made
// WORK_ORDER_CONSUMPTION physical, only one of the five learned about it; the rest kept counting
// consumed stock as present, and a Cycle Count would "find" the consumed quantity as a shortage and
// post an ADJUSTED subtracting the same consumption twice.
//
// MOVEMENT_SIGN being a total Record over the vocabulary stops a new movement type from being
// forgotten INSIDE the authority -- adding one without a sign is a compile error. It does nothing
// about a new derivation written NEXT TO the authority, which is exactly how all five copies got
// there: each was locally reasonable, and none of them was a compile error. That failure is
// invisible to every behavioural test, because a fresh copy is correct on the day it is written.
// The only thing that catches it is a test that reads the source.
//
// This test therefore asserts a SHAPE, not a behaviour:
//
//   RULE A  no source line decides a sign for itself -- a movement-type literal and a `+=`/`-=`
//           in one statement is the exact shape all five copies had.
//   RULE B  no module outside the authority defines its own signedQuantity().
//   RULE C  the modules that DO derive on-hand still import the authority, so the import cannot be
//           quietly replaced by inline arithmetic that rules A and B happen not to match.
//
// ============================ THE KNOWN DEBT, STATED NOT HIDDEN ============================
//
// Rules A and B carry a burn-down allowlist seeded with what already existed, following the
// precedent of field-ops-app-vite/test/ciSuiteCoverage.test.mjs. Every entry is in
// functions/scripts/certificationWorld/ -- the EMULATOR-ONLY certification tooling -- and every one
// of them is missing WORK_ORDER_CONSUMPTION and the RELOCATION pair. So the tools that CHECK the
// world currently disagree with the product about the on-hand of any consumed or relocated part,
// all in the same direction, which ledgerMath.mjs's own header names as the most dangerous shape a
// test suite can take. They are recorded here rather than fixed because they cannot be exercised
// without a Firestore emulator, and the list may only SHRINK.
//
// OFFLINE. Reads source text only: no emulator, no network, no Firestore, no build output.
//
// Run: node --test functions/test/onHandSignAuthorityRatchet.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AUTHORITY = "functions/src/inventoryLedger/locationOnHand.ts";

// Read from the authority itself rather than retyping the vocabulary -- a list of movement types in
// this file would be one more copy, and the newest type is exactly the one a stale list would miss.
const PHYSICAL_TYPES = (() => {
  const src = readFileSync(path.join(REPO, AUTHORITY), "utf8");
  const table = src.slice(src.indexOf("MOVEMENT_SIGN"), src.indexOf("/** The quantity one movement"));
  const types = [...table.matchAll(/^\s{2}([A-Z_]+):\s*"(PLUS|MINUS|SIGNED)"/gm)].map((m) => m[1]);
  assert.ok(types.length >= 9, `could not read MOVEMENT_SIGN out of ${AUTHORITY} (found ${types.length})`);
  return types;
})();

const TYPE_LITERAL = new RegExp(`["'](${PHYSICAL_TYPES.join("|")})["']`);
const SCANNED_ROOTS = ["functions/src", "functions/scripts", "field-ops-app-vite/src"];

function sourceFiles() {
  const out = [];
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "lib" || e.name === "dist") continue;
      const a = path.join(abs, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(a, r);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(r);
    }
  };
  for (const root of SCANNED_ROOTS) walk(path.join(REPO, root), root);
  return out.sort();
}
const read = (rel) => readFileSync(path.join(REPO, rel), "utf8");
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/**
 * Pre-existing sign copies. SHRINK ONLY -- an entry is an admission that a second sign rule is live,
 * not permission to write a third. Deleting a line by routing that file through signedQuantity() is
 * the fix; adding one is not.
 */
const KNOWN_SIGN_COPIES = new Set([
  // Emulator-only certification drivers. Each re-derives on-hand with its own IN/OUT sets and names
  // neither WORK_ORDER_CONSUMPTION nor RELOCATION_IN/RELOCATION_OUT.
  "functions/scripts/certificationWorld/applyCycleVariance.mjs",
  "functions/scripts/certificationWorld/executeCycleCount.mjs",
  "functions/scripts/certificationWorld/executeTransfer.mjs",
  // The shared certification ledger sum. Its own header says it "mirrors the product's" -- it no
  // longer does, for the same three movement types.
  "functions/scripts/certificationWorld/ledgerMath.mjs",
]);
const CEILING = 4;

// ───────────────────────────────────────────────────────────── RULE A: no inline sign decision
test("RULE A -- no source line decides a movement's sign for itself", () => {
  const offenders = [];
  for (const rel of sourceFiles()) {
    if (KNOWN_SIGN_COPIES.has(rel)) continue;
    read(rel).split("\n").forEach((line, i) => {
      if (isComment(line)) return;
      if (TYPE_LITERAL.test(line) && /[+-]=/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "A movement-type literal and a quantity adjustment in one statement IS a copy of the sign rule.\n" +
      `Import signedQuantity from ${AUTHORITY} instead:\n  ${offenders.join("\n  ")}`,
  );
});

// ───────────────────────────────────────────────────── RULE B: one definition of signedQuantity
test("RULE B -- signedQuantity is DEFINED in exactly one place", () => {
  const definers = sourceFiles().filter((rel) => /(export )?function signedQuantity\b|const signedQuantity\s*=/.test(read(rel)));
  const unexpected = definers.filter((rel) => rel !== AUTHORITY && !KNOWN_SIGN_COPIES.has(rel));
  assert.deepEqual(unexpected, [], `A second signedQuantity() is a second authority:\n  ${unexpected.join("\n  ")}`);
  assert.ok(definers.includes(AUTHORITY), "the authority must still define signedQuantity");
});

// ─────────────────────────────────────────── RULE C: the derivations still route through it
/**
 * Every module that turns ledger rows into a quantity. Pinned by NAME so that removing the import
 * and inlining the arithmetic fails here even if rules A and B do not happen to match the shape the
 * replacement takes.
 */
const ON_HAND_DERIVATIONS = [
  "functions/src/cycleCount/cycleCountExpectedQuantity.ts",
  "functions/src/inventoryTransfer/transferOrderCommand.ts",
  "functions/src/fulfillment/fulfillmentAvailability.ts",
  "functions/src/inventoryLedger/mobileLocationPresenceProbe.ts",
  "functions/src/inventoryLedger/binConversionReconciliation.ts",
  "functions/src/inventoryLocation/stockRelocationCommand.ts",
  "functions/src/eosOps/cycleCountRepository.ts",
  "functions/src/eosOps/migration/legacyInventoryMovementMapping.ts",
  // The client side. This was the copy P2-J removed; it now imports the SAME file the server does,
  // across the package boundary, because locationOnHand.ts's only dependency is an `import type`.
  "field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts",
];

test("RULE C -- every on-hand derivation imports the authority", () => {
  const notRouted = ON_HAND_DERIVATIONS.filter((rel) => !/from "[^"]*locationOnHand(\.js)?"/.test(read(rel)));
  assert.deepEqual(notRouted, [], `These derive on-hand without the ONE sign authority:\n  ${notRouted.join("\n  ")}`);
});

test("RULE C -- the client derivation reaches the SAME file the server enforces", () => {
  const src = read("field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts");
  const m = src.match(/from "(\.\.\/)+functions\/src\/inventoryLedger\/locationOnHand"/);
  assert.ok(m, "the client on-hand derivation must import functions/src/inventoryLedger/locationOnHand directly");
  // A mirror would satisfy the import check above while still being a copy; this asserts the
  // specifier resolves to the authority file itself.
  const resolved = path.relative(
    REPO,
    path.resolve(path.join(REPO, "field-ops-app-vite/src/domain"), m[0].slice(6, -1)),
  );
  assert.equal(`${resolved}.ts`, AUTHORITY);
});

// ─────────────────────────────────────────────────────────────── the allowlist is a burn-down
test("the known-copy allowlist may only SHRINK, and every entry must still be real", () => {
  const present = new Set(sourceFiles());
  const stale = [...KNOWN_SIGN_COPIES].filter((rel) => !present.has(rel));
  assert.deepEqual(stale, [], `Allowlist entries that no longer exist must be deleted:\n  ${stale.join("\n  ")}`);
  assert.ok(KNOWN_SIGN_COPIES.size <= CEILING, `the known-copy allowlist grew to ${KNOWN_SIGN_COPIES.size}; it may only shrink`);
});

test("every allowlisted copy is genuinely still a copy -- no entry is kept for free", () => {
  // A stale admission is how an allowlist quietly becomes an exemption. An entry survives only
  // while the file really does decide a sign of its own.
  const notCopies = [...KNOWN_SIGN_COPIES].filter((rel) => {
    const text = read(rel);
    const inlineSign = text.split("\n").some((l) => !isComment(l) && TYPE_LITERAL.test(l) && /[+-]=/.test(l));
    const ownFunction = /(export )?function signedQuantity\b/.test(text);
    return !inlineSign && !ownFunction;
  });
  assert.deepEqual(notCopies, [], `These are no longer sign copies; remove them from the allowlist:\n  ${notCopies.join("\n  ")}`);
});
